import type { CSSProperties } from 'react'
import type { DashboardStats } from '@/lib/owner/signals'

// Four numbers, one row, no interaction. The bar's pulse.
//
// It stays four on purpose. The moment this needs a second row it has stopped
// being a pulse and become a report — and reports already have a home at
// /owner/reports. Anything that wants in has to displace something.
//
// A server component: these are read once with the page and never poll. A
// number that animates on its own pulls the eye away from the alert stack
// directly beneath it, which is the thing actually worth reading.
//
// ── Every cell can say "I don't know" ─────────────────────────────────
// A failed read renders "—", never 0. "No tabs are open" and "I could not
// reach the orders table" are opposite facts, and the confident zero is the
// one that gets somebody into trouble. Each stat carries its own `known` flag
// from lib/owner/signals.ts for exactly this.

const T = {
  openTabs: 'חשבונות פתוחים',
  onFloor: 'על הרצפה',
  stuck: 'פריטים תקועים',
  scheduled: 'משובצים היום',
  unknown: '—',
}

/** Agorot to a whole-shekel display string. Rounded, not truncated, and never
 *  with decimals: this is a glance number, and ₪842.37 reads slower than ₪842
 *  while telling the owner nothing more. */
function shekels(agorot: number): string {
  return `₪${Math.round(agorot / 100).toLocaleString('he-IL')}`
}

export default function StatStrip({ stats }: { stats: DashboardStats }) {
  return (
    <div className="rise" style={strip}>
      {/* Tabs, not tables: a quick purchase has no table and two combined
          tables share one tab. See readFloor() for why the label moved to
          match the query rather than the other way round. */}
      <Stat
        value={stats.floorKnown ? String(stats.openTabs) : T.unknown}
        label={T.openTabs}
        muted={!stats.floorKnown}
      />
      <Stat
        value={stats.floorKnown ? shekels(stats.floorAgorot) : T.unknown}
        label={T.onFloor}
        muted={!stats.floorKnown}
      />
      <Stat
        value={stats.stuckKnown ? String(stats.stuckItems) : T.unknown}
        label={T.stuck}
        muted={!stats.stuckKnown}
        // The only number here that is ever bad news. Colouring it always
        // would make the colour meaningless; colouring it at zero would make
        // a calm bar look alarming; colouring an unknown would invent alarm
        // out of an outage.
        hot={stats.stuckKnown && stats.stuckItems > 0}
      />
      <Stat
        value={stats.scheduleKnown ? String(stats.scheduledToday) : T.unknown}
        label={T.scheduled}
        muted={!stats.scheduleKnown}
      />
    </div>
  )
}

function Stat({ value, label, hot, muted }: {
  value: string; label: string; hot?: boolean; muted?: boolean
}) {
  return (
    <div style={cell}>
      <b style={{
        display: 'block', fontSize: '1.22rem', fontWeight: 800, lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums',
        color: hot ? '#ffb240' : muted ? 'var(--text-faint)' : 'var(--text)',
      }}>{value}</b>
      <small style={{
        display: 'block', fontSize: '0.63rem', color: 'var(--text-faint)',
        fontWeight: 600, marginTop: 3, lineHeight: 1.3,
      }}>{label}</small>
    </div>
  )
}

const strip: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 7,
  marginBottom: 16,
}

const cell: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 13,
  padding: '10px 7px 9px',
  textAlign: 'center',
}
