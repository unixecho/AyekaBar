import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireOwner } from '@/lib/owner/guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { isMissingObject } from '@/lib/server/db-errors'
import {
  PAYSLIP_MAX_BYTES, cleanFileName, isUuid, payslipStoragePath, sniffPayslip, validatePayslipUpload,
  type PayslipUploadError,
} from '@/lib/payslips/rules'
import { PAYSLIP_BUCKET, recordPayslipEvents, staffFullName } from '@/lib/payslips/server'

// POST   /api/owner/payslips   multipart: file, staffId, period (YYYY-MM), note?  → files ONE payslip
// DELETE /api/owner/payslips   { id }                                              → removes it (file AND access)
//
// OWNER ONLY (requireOwner = full admin). The upload screen sends several files as several requests, one each, so a
// single request is never bigger than one payslip and one bad file never sinks the others.
//
// Order of refusals, cheapest and most informative first:
//   same-origin → owner → rate limit → declared size → the file (size, then MAGIC BYTES — never the name or the type
//   the browser claims) → staff id / month → the person exists on the roster and is active.
//
// If the row insert fails after the file went up, the file is removed so no orphan is left in the bucket (a private
// salary document nobody can find is still a salary document).
//
// REMOVAL is real: the row is marked removed FIRST (so nothing can read it from that instant), then the file is
// deleted from the bucket. The row stays as a tombstone with who and when. A payslip filed under the wrong person is
// a privacy breach in itself, which is why "hide it" is not enough.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

const MESSAGES: Record<string, string> = {
  unauthorized: 'יש להתחבר מחדש.',
  rate_limited: 'יותר מדי העלאות — נסו שוב בעוד כמה דקות.',
  not_set_up: 'ספריית התלושים עדיין לא הופעלה במערכת. פנו למפתח.',
  no_file: 'לא נבחר קובץ.',
  empty: 'הקובץ ריק.',
  too_big: 'הקובץ גדול מדי (עד 8MB).',
  bad_type: 'סוג הקובץ לא נתמך. אפשר PDF או תמונה (JPG, PNG, WebP).',
  bad_staff: 'לא נבחר/ה עובד/ת תקין/ה.',
  bad_period: 'החודש לא תקין.',
  note_too_long: 'ההערה ארוכה מדי (עד 300 תווים).',
  not_found: 'התלוש לא נמצא.',
  server: 'משהו השתבש. נסו שוב.',
}
const STATUS: Record<PayslipUploadError, number> = {
  no_file: 400, empty: 400, bad_type: 400, bad_period: 400, bad_staff: 400, note_too_long: 400, too_big: 413,
}

const refuse = (code: string, status: number) =>
  NextResponse.json({ error: code, message: MESSAGES[code] ?? MESSAGES.server }, { status, headers: NO_STORE })

function foreignOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  let host: string | null = null
  try { host = new URL(origin).host } catch { host = null }
  return !host || host !== request.headers.get('host')
}

export async function POST(request: NextRequest) {
  try {
    if (foreignOrigin(request)) return refuse('unauthorized', 403)
    const auth = await requireOwner()
    if (!auth.ok) return auth.res
    if (!(await checkRateLimit(`payslip-upload:${auth.userId}`, 120, 600))) return refuse('rate_limited', 429)

    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > PAYSLIP_MAX_BYTES + 64 * 1024) return refuse('too_big', 413)

    let form: FormData
    try { form = await request.formData() } catch { return refuse('no_file', 400) }
    const file = form.get('file')
    if (!(file instanceof File)) return refuse('no_file', 400)
    if (file.size > PAYSLIP_MAX_BYTES) return refuse('too_big', 413)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const sniffed = sniffPayslip(bytes)
    const checked = validatePayslipUpload({
      size: bytes.byteLength, sniffed, staffId: form.get('staffId'), period: form.get('period'), note: form.get('note'),
    })
    if (!checked.ok) return refuse(checked.error, STATUS[checked.error])
    const mime = sniffed! // validatePayslipUpload refuses null
    const staffId = form.get('staffId') as string

    // The person must be on the roster and still active — a payslip filed under a removed person would be readable by
    // nobody and is almost certainly a mis-pick.
    const { data: target } = await auth.service
      .from('staff').select('id, first_name, last_name, display_name, email, active').eq('id', staffId).maybeSingle()
    if (!target || target.active === false) return refuse('bad_staff', 400)

    const { data: actor } = await auth.service
      .from('staff').select('id, first_name, last_name, display_name, email').eq('auth_user_id', auth.userId).maybeSingle()

    const id = randomUUID()
    const path = payslipStoragePath(staffId, checked.period, id, mime)
    const { error: upErr } = await auth.service.storage
      .from(PAYSLIP_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
    if (upErr) {
      console.error('payslip upload failed:', upErr.message)
      return refuse(/not found|bucket/i.test(upErr.message) ? 'not_set_up' : 'server', /not found|bucket/i.test(upErr.message) ? 503 : 500)
    }

    const { error } = await auth.service.from('staff_payslips').insert({
      id, staff_id: staffId, period: checked.period,
      file_path: path, file_name: cleanFileName(file.name), file_mime: mime, file_bytes: bytes.byteLength,
      uploaded_by: actor?.id ?? null, uploaded_by_name: actor ? staffFullName(actor) : '',
      note: checked.note,
    })
    if (error) {
      console.error('payslip insert failed:', error.code, error.message)
      await auth.service.storage.from(PAYSLIP_BUCKET).remove([path]).catch(() => undefined)
      return isMissingObject(error) ? refuse('not_set_up', 503) : refuse('server', 500)
    }

    await recordPayslipEvents(auth.service, [{ payslip_id: id, actor_staff_id: actor?.id ?? null, kind: 'uploaded' }])
    return NextResponse.json({ ok: true, id, period: checked.period }, { headers: NO_STORE })
  } catch (err) {
    console.error('payslips POST error:', err)
    return refuse('server', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (foreignOrigin(request)) return refuse('unauthorized', 403)
    const auth = await requireOwner()
    if (!auth.ok) return auth.res

    const body = await request.json().catch(() => null) as { id?: unknown } | null
    if (!isUuid(body?.id)) return refuse('not_found', 404)
    const id = body!.id as string

    const { data: actor } = await auth.service.from('staff').select('id').eq('auth_user_id', auth.userId).maybeSingle()

    // Mark removed FIRST, only if it is still live: nothing can read it from this instant, and a double-tap removes once.
    const { data: row, error } = await auth.service
      .from('staff_payslips')
      .update({ removed_at: new Date().toISOString(), removed_by: actor?.id ?? null })
      .eq('id', id).is('removed_at', null)
      .select('id, file_path')
      .maybeSingle()
    if (error) return isMissingObject(error) ? refuse('not_set_up', 503) : refuse('server', 500)
    if (!row) return refuse('not_found', 404)

    await recordPayslipEvents(auth.service, [{ payslip_id: id, actor_staff_id: actor?.id ?? null, kind: 'removed' }])

    const { error: rmErr } = await auth.service.storage.from(PAYSLIP_BUCKET).remove([row.file_path])
    if (rmErr) {
      // The payslip is already unreadable through the app; the file is the part that did not go.
      console.error('payslip file removal failed:', id, rmErr.message)
      return NextResponse.json(
        { ok: true, fileRemoved: false, message: 'התלוש הוסר מהרשימה, אך מחיקת הקובץ מהאחסון נכשלה. פנו למפתח.' },
        { headers: NO_STORE })
    }
    return NextResponse.json({ ok: true, fileRemoved: true }, { headers: NO_STORE })
  } catch (err) {
    console.error('payslips DELETE error:', err)
    return refuse('server', 500)
  }
}
