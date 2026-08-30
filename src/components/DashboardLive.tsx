'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DashboardSignal, DashboardStats } from '@/lib/owner/signals'
import type { DashboardDetails } from '@/lib/owner/signal-details'
import type { ShiftStatusData } from '@/lib/owner/shift-status'
import StatStrip, { type StatKey } from '@/components/StatStrip'
import SignalStack from '@/components/SignalStack'
import OverallViewCard from '@/components/OverallViewCard'
import ShiftStatusCard from '@/components/ShiftStatusCard'

// What keeps the dashboard current without the owner ever hitting reload —
// "everything on the dashboard needs to update without refreshing," 2026-08-30.
//
// The page itself still reads readDashboardSignals()/readDashboardDetails()
// server-side for first paint (fast, no loading flash, works even with JS
// disabled for a beat) — this component takes that as its initial state and
// then polls the ONE endpoint that mirrors it, /api/owner/dashboard, same
// 30s interval + visibilitychange catch-up MenuView already established for
// "live" surfaces in this codebase. No stamp-and-refetch dance like
// MenuView's publish polling: that optimisation exists for a public,
// high-traffic page avoiding a heavier payload on every idle tick; this is
// one owner's own screen reading a handful of small aggregate queries, so
// fetching the real thing every tick is simpler and cheap enough to not earn
// the extra moving part.
//
// A failed poll keeps the LAST good state rather than blanking the screen or
// flashing an error — the same "never surface a failure as a confident zero"
// posture signals.ts documents, just applied to "don't lose what's already
// on screen" instead of "don't lie about zero."

const POLL_MS = 30_000

export default function DashboardLive({
  initialStats, initialSignals, initialDetails, initialOverallDemoMode, initialShiftStatus,
}: {
  initialStats: DashboardStats
  initialSignals: DashboardSignal[]
  initialDetails: DashboardDetails
  initialOverallDemoMode: boolean
  initialShiftStatus: ShiftStatusData
}) {
  const [stats, setStats] = useState(initialStats)
  const [signals, setSignals] = useState(initialSignals)
  const [details, setDetails] = useState(initialDetails)
  const [shiftStatus, setShiftStatus] = useState(initialShiftStatus)
  const [expandedStat, setExpandedStat] = useState<StatKey | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/dashboard', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json() as {
        stats: DashboardStats; signals: DashboardSignal[]; details: DashboardDetails; shiftStatus: ShiftStatusData
      }
      setStats(json.stats)
      setSignals(json.signals)
      setDetails(json.details)
      setShiftStatus(json.shiftStatus)
    } catch {
      // Offline for a beat — keep showing the last good read rather than a
      // blank or an error state; the next tick (or the tab regaining focus)
      // tries again on its own.
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(refresh, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  return (
    <>
      <StatStrip
        stats={stats}
        details={details}
        expanded={expandedStat}
        onToggle={(key) => setExpandedStat((cur) => (cur === key ? null : key))}
      />
      {/* onDemoToggled: the signal stack's own "כיבוי" (turn demo off) action
          changes the SAME app_settings row OverallViewCard's switch does —
          calling refresh() here instead of router.refresh() (2026-08-29's
          fix, which stopped working once this stats/signals surface moved
          into a polled client component) is what makes the row disappear
          immediately instead of waiting for the next 30s tick. */}
      <SignalStack signals={signals} details={details} onDemoToggled={refresh} />

      {/* "a container for shift that gives stats on last shift and notifies
          you when the new shift will start" — sits right under the alerts,
          since shift-starting-soon/shift-not-started (SignalStack, above)
          and this card read the exact same schedule + session data and
          belong next to each other. Purely a status readout — see
          ShiftStatusCard's own header for why the actual open/close action
          stays on /owner/reports and isn't duplicated here. */}
      <ShiftStatusCard status={shiftStatus} />

      {/* 3. The operational birds-eye deck + its demo switch — moved in here
          2026-08-30 so ITS toggle can reach the signal stack's "מצב הדגמה
          פעיל" alert the same instant way, not just the direction above. */}
      <div style={{ marginBottom: 16 }}>
        <OverallViewCard initialDemoMode={initialOverallDemoMode} onToggled={refresh} />
      </div>
    </>
  )
}
