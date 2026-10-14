import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { canReadPayslip, contentDisposition, parseIdList, planZip, zipDownloadName, type PayslipMime } from '@/lib/payslips/rules'
import { zipStream, type ZipEntry } from '@/lib/payslips/zip'
import {
  PAYSLIP_BUCKET, currentPayslipViewer, loadPayslipFiles, namesFor, recordPayslipEvents,
} from '@/lib/payslips/server'

// GET /api/payslips/zip?ids=<uuid>,<uuid>,… — "multiple downloads at once as a zip" (owner, 2026-10-14).
//
// A plain GET on purpose: the browser's own download manager then handles it — progress bar, "save as", resume of
// nothing, no JavaScript holding 100 MB in memory. The session cookie rides along as it does for any navigation.
//
// WHO MAY ASK FOR WHAT is the same single rule as the viewer (canReadPayslip). An employee who lists ids that are not
// theirs does not get an error naming them: those ids are simply not in the archive, exactly as if they did not
// exist; if nothing is left, the answer is a plain 404. The owner may ask for anyone's.
//
// STREAMED, one file at a time: the archive is produced by a pull-based generator (lib/payslips/zip.ts), each file is
// downloaded from the private bucket only when the client has consumed the previous one, and nothing is assembled in
// memory — a 150-file archive costs one payslip of RAM. If the client gives up, the stream is cancelled and the
// remaining files are never fetched. A file that cannot be fetched mid-way is not silently dropped: the archive ends
// with a short `_שגיאות.txt` naming what is missing.
//
// FILE NAMES come from planZip() — sanitised and unique, built from the person's name and the month — never from the
// uploader's original file name, so nothing a stranger typed becomes a path inside the archive.
//
// Every file that was actually delivered is logged ('zipped') when the stream ends.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers: NO_STORE })

export async function GET(request: NextRequest) {
  const viewer = await currentPayslipViewer()
  if (!viewer) return fail(401, 'יש להתחבר מחדש.')

  // `check=1` answers "would this download work, and how big is it?" in JSON, with the SAME validation and no bytes —
  // the page asks first so that a refusal reads as a sentence on the page instead of a JSON document where the
  // download should have been. It has its own, looser budget; only the real download spends the tight one.
  const checkOnly = request.nextUrl.searchParams.get('check') === '1'
  const within = checkOnly
    ? await checkRateLimit(`payslip-zipcheck:${viewer.userId}`, 30, 300)
    : await checkRateLimit(`payslip-zip:${viewer.userId}`, 6, 300)
  if (!within) return fail(429, 'יותר מדי הורדות — נסו שוב בעוד כמה דקות.')

  const ids = parseIdList(request.nextUrl.searchParams.get('ids'))
  if (!ids) return fail(400, 'לא נבחרו תלושים.')

  const service = createServiceClient()
  const found = await loadPayslipFiles(service, ids)
  if (found.tableMissing) return fail(503, 'ספריית התלושים עדיין לא הופעלה. פנו למפתח.')
  if (found.failed) return fail(500, 'משהו השתבש. נסו שוב.')

  const allowed = found.rows.filter((r) => canReadPayslip(viewer, r))
  if (!allowed.length) return fail(404, 'התלושים לא נמצאו.')

  const names = await namesFor(service, allowed.map((r) => r.staff_id))
  const sources = allowed.map((r) => ({
    id: r.id, staff_id: r.staff_id, period: r.period, file_mime: r.file_mime as PayslipMime, file_bytes: r.file_bytes,
    staffName: names.get(r.staff_id) ?? 'עובד',
  }))
  const plan = planZip(sources)
  if (!plan.ok) {
    return plan.error === 'too_many' ? fail(413, 'אפשר להוריד עד 150 תלושים בבת אחת.')
      : plan.error === 'too_big' ? fail(413, 'הקבצים גדולים מדי להורדה אחת — בחרו פחות תלושים.')
      : fail(404, 'התלושים לא נמצאו.')
  }

  if (checkOnly) return NextResponse.json({ ok: true, files: plan.entries.length, bytes: plan.bytes }, { headers: NO_STORE })

  const byId = new Map(allowed.map((r) => [r.id, r]))
  const delivered: string[] = []
  const missing: string[] = []

  async function* entries(): AsyncGenerator<ZipEntry> {
    try {
      for (const e of (plan as Extract<typeof plan, { ok: true }>).entries) {
        const row = byId.get(e.id)!
        const { data: blob, error } = await service.storage.from(PAYSLIP_BUCKET).download(row.file_path)
        if (error || !blob) {
          console.error('payslip zip: download failed:', row.id, error?.message)
          missing.push(e.path)
          continue
        }
        delivered.push(row.id)
        yield { name: e.path, data: new Uint8Array(await blob.arrayBuffer()), mtime: new Date(row.uploaded_at) }
      }
      if (missing.length) {
        yield {
          name: '_שגיאות.txt',
          data: new TextEncoder().encode(`הקבצים הבאים לא נשלפו מהארכיון ולא נכללו כאן. נסו שוב:\n\n${missing.join('\n')}\n`),
        }
      }
    } finally {
      // Runs on completion AND on cancel — only what actually went out is logged.
      await recordPayslipEvents(service, delivered.map((id) => ({ payslip_id: id, actor_staff_id: viewer!.staffId, kind: 'zipped' as const })))
    }
  }

  return new Response(zipStream(entries()), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', zipDownloadName(sources)),
      'X-Content-Type-Options': 'nosniff',
      ...NO_STORE,
    },
  })
}
