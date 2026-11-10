import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isDev } from '@/lib/staff/access'
import { STAFF_CATEGORIES, STAFF_EXCLUDE, sectionsFor } from '@/lib/dashboard/tiles'
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard'
import PreviewFrame from '@/components/glass-preview/PreviewFrame'
import { getOmsStaffDashboardEnabled } from '@/lib/settings/server'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'תצוגה מקדימה · אייכה בר', robots: { index: false, follow: false } }

export default async function GlassStaffPreview() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) redirect('/no-access')
  if (!user) redirect('/login')
  const { data: me, error: staffError } = await supabase.from('staff').select('id, role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (staffError || !me) redirect('/no-access')
  if (isDev(me)) redirect('/owner/preview/glass?view=employee')
  const omsVisible = await getOmsStaffDashboardEnabled()
  const tiles = sectionsFor(me, STAFF_CATEGORIES, STAFF_EXCLUDE).flatMap((section) => section.tiles)
    .filter((tile) => tile.id !== 'loyalty' && (tile.id !== 'pos' || omsVisible))
  return <PreviewFrame tiles={tiles} staffId={me.id} backHref="/staff/dashboard">
    <EmployeeDashboard me={{ ...me, role: me.role ?? 'staff' }} />
  </PreviewFrame>
}
