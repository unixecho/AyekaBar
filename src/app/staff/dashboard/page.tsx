import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getLoyaltyEnabled } from '@/lib/settings/server'
import { badgeMeta } from '@/lib/staff/badges'
import { isDev, isOp } from '@/lib/staff/access'
import { readMyShifts } from '@/lib/staff/my-shifts'
import { zonedNow } from '@/lib/shifts/presence'
import { Z_REPORT_TILE, STAFF_CATEGORIES, STAFF_EXCLUDE, sectionsFor } from '@/lib/dashboard/tiles'
import { zAccessFor } from '@/lib/zreport/server'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import DashboardSections, { type LockedTiles } from '@/components/dashboard/DashboardSections'
import ShiftQuickView from '@/components/dashboard/ShiftQuickView'
import StaffPushCard from '@/components/staff/StaffPushCard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'אזור הצוות · אייכה בר' }
export const dynamic = 'force-dynamic'

// The employee's home (rebuilt 2026-10-13). It used to be a check-in QR, a
// "my shifts" button and — for the general manager — an editor button. It is a
// dashboard now:
//
//   1. who you are, and where you are in your shift (the quick view — the
//      owner asked for it by name),
//   2. the work tiles: my shifts · the POS · the loyalty club,
//   3. whatever else this person's role opens (the GM's editor and schedule,
//      the shift manager's floor), and
//   4. — only inside the 23:00 window, only for someone who may file — the Z
//      report.
//
// The loyalty club is on this screen but LOCKED while the owner's switch is off
// (today), so staff can see it is coming rather than wonder where it went.
//
// The tile list itself is the shared registry (lib/dashboard/tiles.ts); this
// page decides only what is dynamic about it.

async function posShiftOpen(): Promise<boolean | null> {
  try {
    const { data, error } = await createServiceClient()
      .from('waiter_shift_sessions').select('id').eq('status', 'active').limit(1)
    return error ? null : (data?.length ?? 0) > 0
  } catch {
    return null
  }
}

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

  const service = createServiceClient()
  const [loyaltyLive, myShifts, posOpen, zAccess] = await Promise.all([
    getLoyaltyEnabled(),
    readMyShifts(me.id),
    posShiftOpen(),
    zAccessFor(service, { staffId: me.id, role: me.role, badge: me.badge }),
  ])

  const meta = badgeMeta(me.badge, me.role)
  const firstName = me.display_name?.trim() || me.first_name?.trim() || null

  const sections = sectionsFor(me, STAFF_CATEGORIES, STAFF_EXCLUDE)
  // The Z report is a tile only while the window is open for this person.
  if (zAccess.canFile) {
    const work = sections.find((s) => s.category.id === 'mywork')
    if (work) work.tiles = [...work.tiles, Z_REPORT_TILE]
  }
  const locked: LockedTiles = loyaltyLive ? {} : { loyalty: 'בקרוב' }

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
            <Link href={isDev(me) ? '/owner/dev' : '/owner/dashboard'} className="press" style={{
              marginInlineStart: 'auto', fontSize: '0.8rem', fontWeight: 700, color: 'var(--neon-soft)',
              textDecoration: 'none', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '5px 12px',
            }}>
              {isDev(me) ? '🛠️ לוח מפתח' : '⚙️ לוח ניהול'}
            </Link>
          )}
        </div>

        <ShiftQuickView
          shifts={myShifts.shifts}
          roleLabels={myShifts.roleLabels}
          staffId={me.id}
          timezone={myShifts.timezone}
          known={myShifts.known}
          posOpen={posOpen}
          initialNow={zonedNow(myShifts.timezone)}
        />

        <DashboardSections sections={sections} locked={locked} baseDelay={150} />

        {/* Alerts on the phone: shift changes, a reminder before a shift, colleagues giving shifts away.
            The card asks first and only then triggers the browser's one-shot permission dialog; on an
            iPhone in a plain tab it shows the home-screen steps instead. (Added by the scheduler rebuild,
            PR #6; kept here after the 2026-10-13 dashboard rewrite.) */}
        <div className="rise" style={{ animationDelay: '205ms', textAlign: 'start' }}>
          <StaffPushCard variant="home" />
        </div>
      </div>
    </main>
  )
}
