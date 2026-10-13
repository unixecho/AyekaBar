import { isDev, isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { splitName } from '@/lib/staff/name'
import OwnerHeader from '@/components/OwnerHeader'
import DashboardLive from '@/components/DashboardLive'
import SignOutButton from '@/components/SignOutButton'
import DashboardSections from '@/components/dashboard/DashboardSections'
import ZReportCard from '@/components/dashboard/ZReportCard'
import { OWNER_CATEGORIES, sectionsFor } from '@/lib/dashboard/tiles'
import { readZOverview } from '@/lib/zreport/server'
import { readDashboardSignals, OVERALL_DEMO_SIGNAL_ID } from '@/lib/owner/signals'
import { readDashboardDetails } from '@/lib/owner/signal-details'
import { readShiftStatus } from '@/lib/owner/shift-status'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'לוח בקרה · אייכה בר' }

// ── The dashboard, rebuilt 2026-08-29 ─────────────────────────────────
// "the main dashboard will now become the beating heart for the business."
//
// What changed: this page used to BE the back office — the staff roster, the
// portal link fields and the loyalty switches all lived here as cards, with
// the roster growing longer with every hire. Configuration crowded out
// situational awareness, so the screen the owner opens first was the screen
// that told them least about right now.
//
// Those three moved to /owner/staff, /owner/links and /owner/loyalty. What
// stayed is what only this page can do: say what needs attention, and hand
// over to the place that fixes it. The order below is deliberate —
//
//   1. numbers   — the pulse, always four, never more
//   2. signals   — only what is true; absent entirely on a quiet night
//   3. תצוגת על  — the one card that watches the live shift
//   4. tiles     — everything else, one tap away
//
// Nothing was deleted in the move. The only tile that left is צפייה בתפריט,
// which already exists inside the editor (MenuEditor.tsx) — it was a second
// door to a room the first door opens into.

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

  const [{ stats, signals }, details, shiftStatus, zOverview] = await Promise.all([
    readDashboardSignals(),
    readDashboardDetails(),
    readShiftStatus(),
    readZOverview(createServiceClient()),
  ])
  // Derived from the SAME signals read, not a second call to
  // getOverallDemoMode() — that read has its own 60s cache, and a switch
  // reading one answer while the alert above it reads another (during the
  // exact window that matters most, right after someone flips it) is the
  // bug this replaced. See OVERALL_DEMO_SIGNAL_ID's own comment.
  const overallDemoMode = signals.some((s) => s.id === OVERALL_DEMO_SIGNAL_ID)

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* The owner is an employee too — this is the employee dashboard,
              exactly as the staff see it (2026-10-13). The developer's own
              dashboard is a superset of both and is reached from here. */}
          {isDev(me) && (
            <Link href="/owner/dev" className="press" style={headerLink}>🛠️ מפתח</Link>
          )}
          <Link href="/staff/dashboard" className="press" style={headerLink}>🧑‍🍳 תצוגת עובד</Link>
          <SignOutButton />
        </div>
      } />

      {/* 1. The pulse. 2. Only what is true right now, renders nothing when
          nothing is. 3. The operational birds-eye deck + its demo switch.
          All three live in DashboardLive now (2026-08-30): it polls
          /api/owner/dashboard so none of them ever need a page refresh to
          stay current, and owns the tap-to-expand state behind each
          number/alert. Moved the Overall-view card in here too — its demo
          switch and the signal stack's own "מצב הדגמה פעיל" alert both
          describe the SAME app_settings row, and toggling one used to only
          reach the other on the next 30s poll (or never, once
          router.refresh() stopped reaching a client component that owns its
          own polled state) — see StatStrip.tsx/SignalStack.tsx/
          OverallViewCard.tsx and DashboardLive's own refresh() prop. */}
      <DashboardLive
        initialStats={stats} initialSignals={signals} initialDetails={details}
        initialOverallDemoMode={overallDemoMode} initialShiftStatus={shiftStatus}
      />

      {/* 3b. The night's Z report: filed, awaited, or missing. */}
      <ZReportCard overview={zOverview} />

      {/* 4. Everything else, in CATEGORIES (2026-10-13: "organise the dashboard
          for the owner with categories"). It was twelve flat tiles after the
          configuration moved off this screen; they are now grouped by what the
          owner is trying to do — run tonight, change what customers see, look
          after people, keep the system honest. The list lives in the shared
          registry (lib/dashboard/tiles.ts), which the staff and developer
          dashboards read too, so a tile added once appears wherever it belongs.
          Nothing was removed: every tile that was here is still here, and the
          Z-report archive joined under "תפעול שוטף". The accessibility
          statement and the feedback inbox are still tiles for the reason their
          signals go silent when everything is done — they are worth coming back
          to long after the dashboard stops pointing at them. */}
      <DashboardSections sections={sectionsFor(me, OWNER_CATEGORIES)} baseDelay={150} />
    </main>
  )
}

const headerLink: React.CSSProperties = {
  fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)', textDecoration: 'none',
  border: '1px solid var(--line-strong)', borderRadius: 999, padding: '5px 11px', whiteSpace: 'nowrap',
}
