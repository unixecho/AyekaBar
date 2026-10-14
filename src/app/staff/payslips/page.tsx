import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import PayslipLibrary from '@/components/payslips/PayslipLibrary'
import type { PayslipItem } from '@/components/payslips/types'
import { currentPayslipViewer, listPayslips } from '@/lib/payslips/server'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'התלושים שלי · אייכה בר', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// An employee's own payslips (2026-10-14). The query is narrowed to the viewer's own staff row — and it is narrowed
// for the OWNER too: an owner opening their employee view sees their own payslips here, not everyone's (that is
// /owner/payslips). `listPayslips` would otherwise widen for an owner, which is why the id is passed explicitly.
//
// Not signed in → the sign-in page; signed in but not on the roster → the no-access page. Middleware is the first door
// for both; this is the second.

export default async function StaffPayslipsPage() {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) redirect('/login')
  const viewer = await currentPayslipViewer()
  if (!viewer) redirect('/no-access')

  const list = await listPayslips(createServiceClient(), viewer, { staffId: viewer.staffId })
  const items: PayslipItem[] = list.rows.map((r) => ({ ...r, staffName: viewer.name }))

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 16px 40px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/staff/dashboard" right={<SignOutButton />} />
      <PayslipLibrary mode="own" items={items} roster={[]} notSetUp={list.tableMissing} failed={list.failed} />
    </main>
  )
}
