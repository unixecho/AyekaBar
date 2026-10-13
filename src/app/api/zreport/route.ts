import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  Z_MAX_BYTES, sniffMime, validateZSubmission, zStoragePath,
  type ZSubmissionError,
} from '@/lib/zreport/rules'
import { Z_BUCKET, currentStaff, isMissingTable, zAccessFor } from '@/lib/zreport/server'

// POST /api/zreport — a shift manager (or the general manager, or OP) files the
// night's Z report.
//
// ── THE GATE LIVES HERE, NOT IN THE FORM ──────────────────────────────────
// "Only allowed and only shown after 23:00 Israeli time" (owner, 2026-10-13).
// The staff dashboard hides the form outside the window, but the browser's
// clock and DOM are the visitor's to change, so this route re-derives the
// window from the SERVER's clock with the same zAccessFor() the page used and
// refuses outside it. Order of refusals, cheapest and most informative first:
//
//   1. not signed in as active staff                     → 401
//   2. rate limit (a few tries per ten minutes)           → 429
//   3. the window is closed (before 23:00 / after 06:00)  → 403 `closed`
//   4. not a manager, or not set for tonight's shift      → 403 `not_allowed`
//   5. the file: size, then magic bytes (never the name or the MIME the
//      browser claims), then the typed total and note     → 400 / 413
//
// A correction is a NEW row (migration 056); nothing here updates or deletes.
// If the row insert fails after the file went up, the file is removed so no
// orphan is left in the bucket.
//
// Errors are short CODES with a Hebrew message: this is a staff tool, Hebrew
// only, so the sentence travels with the code.

export const runtime = 'nodejs'

const MESSAGES: Record<string, string> = {
  unauthorized: 'יש להתחבר מחדש.',
  rate_limited: 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות.',
  closed: 'אפשר להעלות דוח Z רק בין 23:00 לבוקר.',
  not_allowed: 'רק אחראי/ת המשמרת או המנהל/ת הכללי/ת של הלילה יכולים להעלות את הדוח.',
  not_set_up: 'הארכיון עדיין לא הופעל. פנו למפתח.',
  no_file: 'לא נבחר קובץ.',
  empty: 'הקובץ ריק.',
  too_big: 'הקובץ גדול מדי (עד 8MB).',
  bad_type: 'סוג הקובץ לא נתמך. אפשר תמונה (JPG, PNG, WebP) או PDF.',
  bad_total: 'הסכום לא תקין.',
  note_too_long: 'ההערה ארוכה מדי (עד 500 תווים).',
  server: 'משהו השתבש. נסו שוב.',
}

const refuse = (code: string, status: number) =>
  NextResponse.json({ error: code, message: MESSAGES[code] ?? MESSAGES.server }, { status })

const STATUS: Record<ZSubmissionError, number> = {
  no_file: 400, empty: 400, bad_type: 400, bad_total: 400, note_too_long: 400, too_big: 413,
}

export async function POST(request: NextRequest) {
  try {
    // Same-origin only: this is an authenticated, state-changing POST.
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try { originHost = new URL(origin).host } catch { originHost = null }
      if (!originHost || originHost !== request.headers.get('host')) return refuse('unauthorized', 403)
    }

    // 1. Who
    const viewer = await currentStaff()
    if (!viewer) return refuse('unauthorized', 401)

    // 2. Rate limit (per person)
    if (!(await checkRateLimit(`zreport:${viewer.userId}`, 8, 600))) return refuse('rate_limited', 429)

    // 3 + 4. The clock and the person
    const service = createServiceClient()
    const access = await zAccessFor(service, viewer)
    if (!access.window.open) return refuse('closed', 403)
    if (!access.eligibility.allowed) return refuse('not_allowed', 403)

    // 5. The file
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > Z_MAX_BYTES + 64 * 1024) return refuse('too_big', 413)

    let form: FormData
    try { form = await request.formData() } catch { return refuse('no_file', 400) }
    const file = form.get('file')
    if (!(file instanceof File)) return refuse('no_file', 400)

    if (file.size > Z_MAX_BYTES) return refuse('too_big', 413)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const sniffed = sniffMime(bytes)

    const totalRaw = form.get('total')
    const noteRaw = form.get('note')
    const checked = validateZSubmission({
      size: bytes.byteLength,
      sniffed,
      totalInput: typeof totalRaw === 'string' ? totalRaw : null,
      note: typeof noteRaw === 'string' ? noteRaw : null,
    })
    if (!checked.ok) return refuse(checked.error, STATUS[checked.error])
    const mime = sniffed! // validateZSubmission refuses null

    // The business date comes from the SERVER's window, never from the form.
    const businessDate = access.window.businessDate
    const path = zStoragePath(businessDate, randomUUID(), mime)

    const { error: upErr } = await service.storage
      .from(Z_BUCKET).upload(path, bytes, { contentType: mime, upsert: false })
    if (upErr) {
      console.error('zreport upload failed:', upErr.message)
      // A missing bucket is the "migration 056 not applied" case.
      return refuse(/not found|bucket/i.test(upErr.message) ? 'not_set_up' : 'server', 500)
    }

    const { data, error } = await service
      .from('z_reports')
      .insert({
        business_date: businessDate,
        uploaded_by: viewer.staffId,
        uploaded_by_name: viewer.name,
        file_path: path,
        file_mime: mime,
        file_bytes: bytes.byteLength,
        total_agorot: checked.totalAgorot,
        note: checked.note,
      })
      .select('id, business_date, uploaded_at')
      .single()

    if (error) {
      console.error('zreport insert failed:', error.code, error.message)
      await service.storage.from(Z_BUCKET).remove([path]).catch(() => undefined)
      return refuse(isMissingTable(error) ? 'not_set_up' : 'server', 500)
    }

    return NextResponse.json({ ok: true, businessDate: data.business_date, uploadedAt: data.uploaded_at })
  } catch (err) {
    console.error('zreport route error:', err)
    return refuse('server', 500)
  }
}
