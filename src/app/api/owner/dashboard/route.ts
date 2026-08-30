import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'
import { readDashboardSignals, OVERALL_DEMO_SIGNAL_ID } from '@/lib/owner/signals'
import { readDashboardDetails } from '@/lib/owner/signal-details'
import { readShiftStatus } from '@/lib/owner/shift-status'

// The one endpoint that keeps /owner/dashboard live without a page refresh.
// DashboardLive polls this on an interval and swaps its state in place —
// same stats/signals the server component reads for first paint, plus the
// drill-down lists behind each expandable panel, so a poll tick never needs
// a second round trip just because the owner had something expanded when it
// landed. requireOwner() is the same gate the page itself re-checks
// server-side; this route exists because a client component cannot reach
// readDashboardSignals()'s service-role reads directly.
export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const [signals, details, shiftStatus] = await Promise.all([
    readDashboardSignals(),
    readDashboardDetails(),
    readShiftStatus(),
  ])

  return NextResponse.json({
    stats: signals.stats,
    signals: signals.signals,
    details,
    shiftStatus,
    // Same signals read, not a second app_settings query — see
    // OVERALL_DEMO_SIGNAL_ID's own comment for why that matters here
    // specifically (a stale second answer during the window right after
    // someone flips the switch is the exact bug this replaced).
    overallDemoMode: signals.signals.some((s) => s.id === OVERALL_DEMO_SIGNAL_ID),
  })
}
