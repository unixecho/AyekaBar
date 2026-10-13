import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'
import { Z_BUCKET } from '@/lib/zreport/server'

// GET /api/owner/z-reports/file?id=<uuid> — stream one uploaded Z report to the
// OWNER. The bucket is private with no storage policies (migration 056), so
// this route IS the only way to read a file; it re-checks OP, looks the path up
// in the table by id (the caller never supplies a path), and serves the bytes
// inline with headers that keep an uploaded file inert:
//
//   • Content-Type comes from the row — sniffed by magic bytes at upload — and
//     X-Content-Type-Options: nosniff stops the browser second-guessing it;
//   • a restrictive CSP (`default-src 'none'`, plus `sandbox` for images) means
//     that even if a crafted file reached here, nothing in it can run script in
//     this origin. `sandbox` is withheld from PDFs only because Chrome refuses
//     to render a PDF inside a sandboxed document; the magic-byte check at
//     upload is what keeps anything but a real PDF from being served as one;
//   • private, no-store: the takings of a night are not for shared caches.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'מזהה לא תקין' }, { status: 400 })

  const { data: row, error } = await auth.service
    .from('z_reports').select('file_path, file_mime, business_date').eq('id', id).maybeSingle()
  if (error || !row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })

  const { data: blob, error: dlErr } = await auth.service.storage.from(Z_BUCKET).download(row.file_path)
  if (dlErr || !blob) return NextResponse.json({ error: 'הקובץ לא נמצא' }, { status: 404 })

  const isPdf = row.file_mime === 'application/pdf'
  const ext = row.file_mime === 'application/pdf' ? 'pdf' : row.file_mime === 'image/png' ? 'png' : row.file_mime === 'image/webp' ? 'webp' : 'jpg'
  return new NextResponse(blob, {
    headers: {
      'Content-Type': row.file_mime,
      'Content-Disposition': `inline; filename="z-report-${row.business_date}.${ext}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': isPdf
        ? "default-src 'none'"
        : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  })
}
