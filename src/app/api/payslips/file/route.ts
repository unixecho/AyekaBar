import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { PAYSLIP_EXTENSION, canReadPayslip, contentDisposition, isUuid, periodStamp } from '@/lib/payslips/rules'
import {
  PAYSLIP_BUCKET, currentPayslipViewer, loadPayslipFiles, markFirstViewed, namesFor, recordPayslipEvents,
} from '@/lib/payslips/server'

// GET /api/payslips/file?id=<uuid>[&download=1] — stream ONE payslip to the person allowed to read it.
//
// The bucket is private with no storage policies (migration 060), so this route IS the only way to read a file. In
// order, cheapest and most revealing-last:
//
//   1. signed in as an ACTIVE staff member (the session — never a header or a query field)   → 401
//   2. a per-person rate limit                                                               → 429
//   3. the id is a UUID                                                                      → 400
//   4. the row exists AND canReadPayslip(viewer, row) — the one access rule, in lib/payslips/rules.ts.
//      A payslip that is not yours is answered exactly like one that does not exist (404): the response must not
//      confirm that a given id is somebody's payslip.
//   5. the bytes come from the bucket by the path stored in the ROW — the caller never supplies a path.
//
// The response is inert: the type comes from the row (set from the file's magic bytes at upload), nosniff stops the
// browser second-guessing it, and a CSP of `default-src 'none'` (plus `sandbox` for images) means that even if a
// crafted file ever reached here nothing in it could run in this origin. `sandbox` is withheld from PDFs only because
// Chrome refuses to render a PDF inside a sandboxed document. `private, no-store`: salary is not for shared caches.
//
// Every read leaves a row in the access log, and the EMPLOYEE's own first read stamps employee_first_viewed_at (the
// owner reading it does not — that field means "the person has seen it").

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const fail = (status: number, message: string) => NextResponse.json({ error: message }, { status, headers: NO_STORE })

export async function GET(request: NextRequest) {
  const viewer = await currentPayslipViewer()
  if (!viewer) return fail(401, 'יש להתחבר מחדש.')

  if (!(await checkRateLimit(`payslip-file:${viewer.userId}`, 120, 300))) return fail(429, 'יותר מדי בקשות — נסו שוב בעוד רגע.')

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!isUuid(id)) return fail(400, 'מזהה לא תקין.')
  const download = request.nextUrl.searchParams.get('download') === '1'

  const service = createServiceClient()
  const found = await loadPayslipFiles(service, [id])
  if (found.tableMissing) return fail(503, 'ספריית התלושים עדיין לא הופעלה. פנו למפתח.')
  if (found.failed) return fail(500, 'משהו השתבש. נסו שוב.')
  const row = found.rows[0]
  if (!row || !canReadPayslip(viewer, row)) return fail(404, 'התלוש לא נמצא.')

  const { data: blob, error } = await service.storage.from(PAYSLIP_BUCKET).download(row.file_path)
  if (error || !blob) {
    console.error('payslip download failed:', row.id, error?.message)
    return fail(404, 'הקובץ לא נמצא.')
  }

  // Log first, then stamp: both best-effort and neither can fail the read.
  await recordPayslipEvents(service, [{ payslip_id: row.id, actor_staff_id: viewer.staffId, kind: download ? 'downloaded' : 'viewed' }])
  if (row.staff_id === viewer.staffId && !row.employee_first_viewed_at) await markFirstViewed(service, row.id)

  const ext = PAYSLIP_EXTENSION[row.file_mime]
  const who = (await namesFor(service, [row.staff_id])).get(row.staff_id) ?? ''
  const isPdf = row.file_mime === 'application/pdf'
  return new NextResponse(blob, {
    headers: {
      'Content-Type': row.file_mime,
      'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', {
        utf8: `תלוש שכר ${periodStamp(row.period)}${who ? ` - ${who}` : ''}.${ext}`,
        ascii: `payslip-${periodStamp(row.period)}.${ext}`,
      }),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': isPdf
        ? "default-src 'none'"
        : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      ...NO_STORE,
    },
  })
}
