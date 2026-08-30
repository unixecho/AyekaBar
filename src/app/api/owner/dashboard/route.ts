import { NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'
import { readDashboardSignals } from '@/lib/owner/signals'
import { readDashboardDetails } from '@/lib/owner/signal-details'

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

  const [signals, details] = await Promise.all([
    readDashboardSignals(),
    readDashboardDetails(),
  ])

  return NextResponse.json({
    stats: signals.stats,
    signals: signals.signals,
    details,
  })
}
