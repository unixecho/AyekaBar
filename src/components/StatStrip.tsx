'use client'

import type { CSSProperties } from 'react'
import type { DashboardStats } from '@/lib/owner/signals'
import type { DashboardDetails } from '@/lib/owner/signal-details'
import { OpenTabsList, ScheduledTodayList, StuckItemsList } from '@/components/DashboardDetailLists'

// Four numbers, one row — the bar's pulse. Stays four on purpose: the moment
// this needs a second row it has stopped being a pulse and become a report.
//
// 2026-08-30: each number is now a door, not just a glance. "Open tabs",
// "on the floor" (the same tabs, summed) and "stuck items" and "scheduled
// today" all expand — a fifth, full-width card drops in below the strip —
// to name exactly which tabs/items/people they mean. See
// DashboardDetailLists.tsx for the shared row rendering, reused by
// SignalStack's own expandable rows so the same number never explains
// itself two different ways. Live: DashboardLive polls the data this
// receives, so a tap-open panel shows whatever the last poll actually found.
//
// ── Every cell can say "I don't know" ─────────────────────────────────
// A failed read renders "—", never 0. "No tabs are open" and "I could not
// reach the orders table" are opposite facts, and the confident zero is the
// one that gets somebody into trouble. Each stat carries its own `known` flag
// from lib/owner/signals.ts for exactly this. An unknown stat cannot be
// expanded — there is nothing to open.

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

/** 'floor' backs BOTH openTabs and onFloor — they're the same underlying
 *  tabs, one counted and one summed, so tapping either opens one shared
 *  breakdown rather than two panels showing the same rows twice. */
export type StatKey = 'floor' | 'stuck' | 'scheduled'

export default function StatStrip({
  stats, details, expanded, onToggle,
}: {
  stats: DashboardStats
  details: DashboardDetails
  /** null = nothing expanded. Owned by DashboardLive so a poll tick can
   *  refresh the open panel's contents without collapsing it. */
  expanded: StatKey | null
  onToggle: (key: StatKey) => void
}) {
  return (
    <>
      <div className="rise" style={{ ...strip, marginBottom: expanded ? 7 : 16 }}>
        {/* Tabs, not tables: a quick purchase has no table and two combined
            tables share one tab. See readFloor() for why the label moved to
            match the query rather than the other way round. */}
        <Stat
          value={stats.floorKnown ? String(stats.openTabs) : T.unknown}
          label={T.openTabs}
          muted={!stats.floorKnown}
          expandable={stats.floorKnown}
          open={expanded === 'floor'}
          onClick={() => onToggle('floor')}
        />
        <Stat
          value={stats.floorKnown ? shekels(stats.floorAgorot) : T.unknown}
          label={T.onFloor}
          muted={!stats.floorKnown}
          expandable={stats.floorKnown}
          open={expanded === 'floor'}
          onClick={() => onToggle('floor')}
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
          expandable={stats.stuckKnown}
          open={expanded === 'stuck'}
          onClick={() => onToggle('stuck')}
        />
        <Stat
          value={stats.scheduleKnown ? String(stats.scheduledToday) : T.unknown}
          label={T.scheduled}
          muted={!stats.scheduleKnown}
          expandable={stats.scheduleKnown}
          open={expanded === 'scheduled'}
          onClick={() => onToggle('scheduled')}
        />
      </div>

      {expanded && (
        <div className="rise" style={panel}>
          {expanded === 'floor' && <OpenTabsList rows={details.openTabs} />}
          {expanded === 'stuck' && <StuckItemsList rows={details.stuckItems} />}
          {expanded === 'scheduled' && <ScheduledTodayList rows={details.scheduledToday} />}
        </div>
      )}
    </>
  )
}

function Stat({ value, label, hot, muted, expandable, open, onClick }: {
  value: string; label: string; hot?: boolean; muted?: boolean
  expandable: boolean; open: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      className="press"
      disabled={!expandable}
      onClick={onClick}
      aria-expanded={expandable ? open : undefined}
      style={{ ...cell, cursor: expandable ? 'pointer' : 'default', borderColor: open ? 'var(--neon-soft)' : 'var(--line)' }}
    >
      <b style={{
        display: 'block', fontSize: '1.22rem', fontWeight: 800, lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums',
        color: hot ? '#ffb240' : muted ? 'var(--text-faint)' : 'var(--text)',
      }}>{value}</b>
      <small style={{
        display: 'block', fontSize: '0.63rem', color: 'var(--text-faint)',
        fontWeight: 600, marginTop: 3, lineHeight: 1.3,
      }}>{label}</small>
    </button>
  )
}

const strip: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 7,
}

const cell: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 13,
  padding: '10px 7px 9px',
  textAlign: 'center',
  font: 'inherit',
  color: 'inherit',
  width: '100%',
  transition: 'border-color .2s var(--ease)',
}

const panel: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 13,
  padding: '11px 11px 12px',
  marginBottom: 16,
}
