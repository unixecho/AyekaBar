import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { isOp, isDev } from '@/lib/staff/access'
import { OWNER_CATEGORIES, DEV_CATEGORIES, sectionsFor } from '@/lib/dashboard/tiles'
import OwnerDashboard from '@/components/dashboard/OwnerDashboard'
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard'
import DashboardSections from '@/components/dashboard/DashboardSections'
import DevFlagsCard from '@/components/dashboard/DevFlagsCard'
import LensTabs from '@/components/dashboard/LensTabs'
import { parseLens } from '@/lib/dashboard/lens'
import PreviewFrame from '@/components/glass-preview/PreviewFrame'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'תצוגה מקדימה · אייכה בר', robots: { index: false, follow: false } }

export default async function GlassPreview({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) redirect('/no-access')
  if (!user) redirect('/login')
  const { data: me, error: staffError } = await supabase.from('staff').select('id, role, badge').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  if (staffError || !me || !isOp(me)) redirect('/no-access')
  const dev = isDev(me)
  const categories = dev ? DEV_CATEGORIES : OWNER_CATEGORIES
  const tiles = sectionsFor(me, categories).flatMap((section) => section.tiles)
    .filter((tile) => dev || tile.id !== 'loyalty-admin')
  const params = await searchParams
  return <PreviewFrame tiles={tiles} staffId={me.id} backHref={dev ? '/owner/dev' : '/owner/dashboard'}>
    {dev ? <LensTabs initial={parseLens(params.view)} panels={{
      manager: <OwnerDashboard me={me} />,
      employee: <EmployeeDashboard me={{ ...me, role: me.role ?? 'staff' }} />,
      dev: <><DevFlagsCard /><DashboardSections sections={sectionsFor(me, DEV_CATEGORIES).filter((s) => s.category.id === 'dev')} /></>,
    }} /> : <OwnerDashboard me={me} />}
  </PreviewFrame>
}
