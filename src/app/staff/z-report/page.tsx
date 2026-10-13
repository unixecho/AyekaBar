import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import ZReportForm, { type ExistingReport } from '@/components/ZReportForm'
import { businessDateLabel, fmtShekels } from '@/lib/zreport/rules'
import { currentStaff, zAccessFor, zStatusFor } from '@/lib/zreport/server'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'העלאת דוח Z · אייכה בר', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// The Z-report upload page (2026-10-13). "…only allowed and should only show
// after 23:00 Israeli time" — so outside the window, or for anyone who may not
// file, this page does not render at all: it sends them back to their
// dashboard, where the tile is absent for the same reason. The decision is the
// same zAccessFor() the upload API uses, so the page and the API agree.

const hm = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false })

export default async function ZReportPage() {
  const viewer = await currentStaff()
  if (!viewer) redirect('/login')

  const service = createServiceClient()
  const access = await zAccessFor(service, viewer)
  if (!access.canFile) redirect('/staff/dashboard')

  const status = await zStatusFor(service, access.window.businessDate)
  const existing: ExistingReport | null = status.current
    ? {
        uploadedAt: hm.format(new Date(status.current.uploaded_at)),
        uploadedByName: status.current.uploaded_by_name || 'צוות',
        totalLabel: fmtShekels(status.current.total_agorot),
      }
    : null

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/staff/dashboard" right={<SignOutButton />} />
      <ZReportForm
        businessDateLabel={businessDateLabel(access.window.businessDate)}
        existing={existing}
        notSetUp={status.tableMissing}
      />
    </main>
  )
}
