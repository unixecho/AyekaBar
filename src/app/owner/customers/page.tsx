import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import CustomerManager from '@/components/CustomerManager'
import SignOutButton from '@/components/SignOutButton'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'לקוחות ונקודות · אייכה בר' }

export default async function OwnerCustomersPage() {
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
      {/* Parent is /owner/loyalty (see rewards/page.tsx's own note) — reached
          through the loyalty screen's tile grid, not the dashboard directly. */}
      <OwnerHeader backHref="/owner/loyalty" right={<SignOutButton />} />
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <CustomerManager />
      </div>
    </main>
  )
}
