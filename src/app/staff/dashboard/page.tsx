import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { badgeMeta } from '@/lib/staff/badges'
import { isDev, isOp } from '@/lib/staff/access'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard'
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
  const supabase = createClient()
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

  const meta = badgeMeta(me.badge, me.role)
  const firstName = me.display_name?.trim() || me.first_name?.trim() || null

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader right={<SignOutButton />} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="rise" style={{ animationDelay: '30ms', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)' }}>
            {firstName ? `שלום, ${firstName}` : 'שלום'}
          </h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color,
            borderRadius: 999, padding: '3px 11px', fontSize: '0.76rem', fontWeight: 700,
          }}>
            <span aria-hidden>{meta.emoji}</span>{meta.he}
          </span>
          {/* Owners and the developer are employees too. Their own dashboards
              are one tap away from here, and this is theirs to open as an
              employee — the view the staff actually see. */}
          {isOp(me) && (
            <Link href="/owner/dashboard" className="press" style={{
              marginInlineStart: 'auto', fontSize: '0.8rem', fontWeight: 700, color: 'var(--neon-soft)',
              textDecoration: 'none', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '5px 12px',
            }}>
              ⚙️ לוח ניהול
            </Link>
          )}
        </div>

        <EmployeeDashboard me={me} />
      </div>
    </main>
  )
}
