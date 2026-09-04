import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import RewardsManager from '@/components/RewardsManager'
import SignOutButton from '@/components/SignOutButton'

export default async function OwnerRewardsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      {/* Parent is /owner/loyalty, not the dashboard — this page is reached
          through the loyalty screen's own tile grid, and a back button that
          skips straight to the dashboard would jump over the page the owner
          actually came from. */}
      <OwnerHeader backHref="/owner/loyalty" right={<SignOutButton />} />
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <RewardsManager />
      </div>
    </main>
  )
}
