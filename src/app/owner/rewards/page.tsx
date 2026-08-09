import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import Link from 'next/link'
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
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/owner/dashboard" style={{ textDecoration: 'none', fontSize: '0.82rem', color: 'var(--text-faint)' }}>← ניהול</Link>
          <SignOutButton />
        </div>
      } />
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <RewardsManager />
      </div>
    </main>
  )
}
