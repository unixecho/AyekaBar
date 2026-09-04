import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import PortalLinksEditor from '@/components/PortalLinksEditor'
import SignOutButton from '@/components/SignOutButton'
import { getPortalLinks } from '@/lib/settings/server'

// Split out of /owner/dashboard on 2026-08-29. Six URL fields that are edited
// roughly never and read by every visitor to the portal — exactly the shape of
// thing that should not occupy a screen the owner opens mid-service.
//
// Middleware gates this via OP_ONLY_PREFIXES; the check below is the same
// defense-in-depth re-check every other /owner/* page does.

export default async function OwnerLinksPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const portalLinks = await getPortalLinks()

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />

      <div className="rise" style={{ animationDelay: '140ms' }}>
        <PortalLinksEditor initialLinks={portalLinks} />
      </div>

      <p className="rise" style={{
        fontSize: '0.78rem', color: 'var(--text-faint)', lineHeight: 1.6,
        margin: '16px 2px 0', animationDelay: '200ms',
      }}>
        הקישורים נשמרים ב-Supabase ונקראים ישירות מהפורטל — שינוי כאן משנה את
        הכפתורים באתר מיד, בלי פריסה מחדש.
      </p>
    </main>
  )
}
