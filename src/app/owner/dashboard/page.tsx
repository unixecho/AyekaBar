import { isDev, isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { splitName } from '@/lib/staff/name'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import OwnerDashboard from '@/components/dashboard/OwnerDashboard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'לוח בקרה · אייכה בר' }

// ── The dashboard, rebuilt 2026-08-29 ─────────────────────────────────
// "the main dashboard will now become the beating heart for the business."
//
// This page used to BE the back office; configuration moved to /owner/staff, /owner/links and /owner/loyalty and what
// stayed is what only a dashboard can do: say what needs attention, and hand over to the place that fixes it. The
// body (numbers, signals, the shift deck, tiles) lives in components/dashboard/OwnerDashboard.tsx since 2026-10-15,
// because the developer's single dashboard shows it as a lens. This page owns who gets in and the header.
//
// The developer has no separate manager page any more (owner, 2026-10-15) — /owner/dev?view=manager IS this, so a
// developer who lands here is sent there.

export const dynamic = 'force-dynamic'

export default async function OwnerDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Middleware already gates this, but verify server-side too (defense in depth).
  const { data: me } = await supabase
    .from('staff')
    .select('role, badge, email, first_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me || !isOp(me)) redirect('/no-access')

  // Self-heal: a manually-seeded owner row has no name/email — backfill it from
  // the owner's own Google profile so the roster shows them properly.
  //
  // Deliberately left HERE and not moved to /owner/staff with the roster it
  // fixes: this is the page the owner actually opens, and a repair that only
  // runs on a page they may never visit is a repair that never runs.
  if (!me.email || !me.first_name) {
    const { first, last } = splitName(user)
    await createServiceClient()
      .from('staff')
      .update({ email: user.email, first_name: first, last_name: last })
      .eq('auth_user_id', user.id)
  }

  // The developer's one perspective holds the manager view as a lens.
  if (isDev(me)) redirect('/owner/dev?view=manager')

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* The owner is an employee too — this is the employee dashboard, exactly as the staff see it (2026-10-13). */}
          <Link href="/staff/dashboard" className="press" style={headerLink}>🧑‍🍳 תצוגת עובד</Link>
          <SignOutButton />
        </div>
      } />

      <OwnerDashboard me={me} />
    </main>
  )
}

const headerLink: React.CSSProperties = {
  fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)', textDecoration: 'none',
  border: '1px solid var(--line-strong)', borderRadius: 999, padding: '5px 11px', whiteSpace: 'nowrap',
}
