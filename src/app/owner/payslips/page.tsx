import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import PayslipLibrary from '@/components/payslips/PayslipLibrary'
import type { PayslipItem } from '@/components/payslips/types'
import { currentPayslipViewer, listPayslips, namesFor, payslipRoster } from '@/lib/payslips/server'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'תלושי שכר · אייכה בר', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// The owner's payslip library (2026-10-14): upload, read everyone's in the viewer, download any selection as a ZIP.
//
// OP only — salary is the most private thing the bar holds about a person, so this follows the feedback inbox and the
// Z-report archive and is NOT widened to the general manager. Middleware is the first door (the prefix is in
// OP_ONLY_PREFIXES); this page re-checks, and every route it calls checks again.

export default async function OwnerPayslipsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('staff').select('role, badge').eq('auth_user_id', user.id).maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const viewer = await currentPayslipViewer()
  if (!viewer || !viewer.isOp) redirect('/no-access')

  const service = createServiceClient()
  const [list, roster] = await Promise.all([listPayslips(service, viewer, { limit: 2000 }), payslipRoster(service)])
  // Names include people since removed from the roster — their history stays readable and named.
  const names = await namesFor(service, list.rows.map((r) => r.staff_id))
  const items: PayslipItem[] = list.rows.map((r) => ({ ...r, staffName: names.get(r.staff_id) ?? 'עובד/ת' }))

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 16px 40px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />
      <PayslipLibrary mode="all" items={items} roster={roster} notSetUp={list.tableMissing} failed={list.failed} />
    </main>
  )
}
