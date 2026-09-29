import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import SiteLanguagesCard from '@/components/SiteLanguagesCard'
import SignOutButton from '@/components/SignOutButton'
import { getSiteLanguageSettings } from '@/lib/settings/server'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'שפות האתר · אייכה בר' }

// Which languages the public portal and menu offer. Its own page rather than a
// card on the dashboard for the reason /owner/links gives: a setting changed
// roughly never should not occupy the screen the owner opens mid-service.
//
// Middleware gates this via OP_ONLY_PREFIXES; the check below is the same
// defense-in-depth re-check every other /owner/* page does.

export default async function OwnerLanguagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const languages = await getSiteLanguageSettings()

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />

      <div className="rise" style={{ animationDelay: '140ms' }}>
        <SiteLanguagesCard initial={languages} />
      </div>
    </main>
  )
}
