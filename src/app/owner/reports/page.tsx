import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import ReportsManager from '@/components/ReportsManager'
import SignOutButton from '@/components/SignOutButton'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'דוחות ומשמרות · אייכה בר' }

export default async function OwnerReportsPage() {
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
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 640, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <ReportsManager />
      </div>
    </main>
  )
}
