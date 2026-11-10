import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isDev, isOp } from '@/lib/staff/access'
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard'
import PreviewFrame from '@/components/glass-preview/PreviewFrame'
import { STAFF_CATEGORIES, STAFF_EXCLUDE, sectionsFor } from '@/lib/dashboard/tiles'
import { getOmsStaffDashboardEnabled } from '@/lib/settings/server'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'אזור הצוות · אייכה בר' }
export const dynamic = 'force-dynamic'

// The employee's home (rebuilt 2026-10-13; its body moved to components/dashboard/EmployeeDashboard.tsx 2026-10-15 so the
// developer's single dashboard can show exactly the same thing as a lens). This page owns who is allowed in and the
// greeting; the body owns everything under it.
//
// The developer has no separate employee page any more (owner, 2026-10-15: "one perspective that has all 3 views") —
// /owner/dev?view=employee IS this, so a developer who lands here is sent there.

export default async function StaffDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Being signed in with Google is not being staff. Middleware gates this too
  // (and claims a pending invite on the way in), but check here as well —
  // same defense-in-depth pattern as the /owner/* pages.
  const { data: me } = await supabase
    .from('staff')
    .select('id, role, badge, first_name, display_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me) redirect('/no-access')

  // The developer's one perspective holds the employee view as a lens.
  if (isDev(me)) redirect('/owner/dev?view=employee')

  const omsVisible = await getOmsStaffDashboardEnabled()
  const tiles = sectionsFor(me, STAFF_CATEGORIES, STAFF_EXCLUDE).flatMap((section) => section.tiles)
    .filter((tile) => tile.id !== 'loyalty' && (tile.id !== 'pos' || omsVisible))
  return <PreviewFrame mode="live" tiles={tiles} staffId={me.id} backHref="/staff/dashboard"
    scheduleHref="/staff/schedule" secondaryLink={isOp(me) ? { href: '/owner/dashboard', label: 'לוח ניהול' } : undefined}>
    <EmployeeDashboard me={me} />
  </PreviewFrame>
}
