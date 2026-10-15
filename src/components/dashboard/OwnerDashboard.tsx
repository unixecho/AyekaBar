import { createServiceClient } from '@/lib/supabase/server'
import DashboardLive from '@/components/DashboardLive'
import DashboardSections from '@/components/dashboard/DashboardSections'
import ZReportCard from '@/components/dashboard/ZReportCard'
import StaffPushCard from '@/components/staff/StaffPushCard'
import DevPushPanel from '@/components/staff/DevPushPanel'
import { OWNER_CATEGORIES, sectionsFor } from '@/lib/dashboard/tiles'
import { readZOverview } from '@/lib/zreport/server'
import { readDashboardSignals, OVERALL_DEMO_SIGNAL_ID } from '@/lib/owner/signals'
import { readDashboardDetails } from '@/lib/owner/signal-details'
import { readShiftStatus } from '@/lib/owner/shift-status'
import type { AccessRow } from '@/lib/staff/access'

// The owner / manager dashboard BODY — everything under the header (rebuilt 2026-08-29, "the beating heart for the
// business"; moved out of the page 2026-10-15 so the developer's single dashboard can show it as its "manager" lens).
//
// The order is deliberate:
//   1. numbers   — the pulse, always four, never more
//   2. signals   — only what is true; absent entirely on a quiet night
//   3. תצוגת על  — the one card that watches the live shift
//   4. the Z report: filed, awaited, or missing
//   5. tiles     — everything else, in categories, one tap away
//
// DashboardLive polls /api/owner/dashboard every 30s, so none of it needs a refresh; it also owns the tap-to-expand
// state and hosts the Overall-view card so its demo switch and the signal stack's own "מצב הדגמה פעיל" alert — the
// same `app_settings` row — can each trigger an immediate re-poll of the other.

export default async function OwnerDashboard({ me }: { me: AccessRow }) {
  const [{ stats, signals }, details, shiftStatus, zOverview] = await Promise.all([
    readDashboardSignals(),
    readDashboardDetails(),
    readShiftStatus(),
    readZOverview(createServiceClient()),
  ])
  // Derived from the SAME signals read, not a second call to getOverallDemoMode() — that read has its own 60s cache,
  // and a switch reading one answer while the alert above it reads another (right after someone flips it) is the bug
  // this replaced. See OVERALL_DEMO_SIGNAL_ID's own comment.
  const overallDemoMode = signals.some((s) => s.id === OVERALL_DEMO_SIGNAL_ID)

  return (
    <>
      <DashboardLive
        initialStats={stats} initialSignals={signals} initialDetails={details}
        initialOverallDemoMode={overallDemoMode} initialShiftStatus={shiftStatus}
      />

      {/* Phone alerts for the owner too: a colleague asking for a shift, a request or swap waiting for a decision. */}
      <div className="rise" style={{ animationDelay: '120ms', marginBottom: 14 }}>
        <StaffPushCard variant="home" />
      </div>

      <ZReportCard overview={zOverview} />

      <DashboardSections sections={sectionsFor(me, OWNER_CATEGORIES)} baseDelay={150} />

      {/* The owner's push test bench: sends real alerts to this owner only and shows what the server sees. */}
      <DevPushPanel />
    </>
  )
}
