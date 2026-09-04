import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import StaffManager from '@/components/StaffManager'
import SignOutButton from '@/components/SignOutButton'

// Split out of /owner/dashboard on 2026-08-29. The roster was the longest
// thing on that page by a wide margin — every other control sat above a list
// that grows with the business, so the dashboard got harder to read every
// time someone was hired.

export default async function OwnerStaffPage() {
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
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />

      <div className="rise" style={{ animationDelay: '140ms' }}>
        <StaffManager currentUserId={user.id} />
      </div>
    </main>
  )
}
