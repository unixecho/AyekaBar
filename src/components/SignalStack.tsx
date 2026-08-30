'use client'

import { useState, type CSSProperties, type ReactNode } from 'react'
import Link from 'next/link'
import { haptic } from '@/lib/haptics'
import type { DashboardSignal, SignalSeverity } from '@/lib/owner/signals'
import type { DashboardDetails } from '@/lib/owner/signal-details'
import { MenuChangesList, StuckItemsList } from '@/components/DashboardDetailLists'

// The dashboard's alert stack. Renders nothing at all when there is nothing to
// say — see the header of lib/owner/signals.ts for why that matters more than
// any styling decision in this file.
//
// Ordering is decided upstream (each signal carries a fixed `rank`), not here.
// A component that re-sorted by its own idea of urgency would make the stack
// jitter between two loads with identical contents.
//
// 2026-08-30: two rows now expand IN PLACE instead of only linking away —
// "פריט תקוע" (which items, which table, whose) and "שינויים בתפריט לא
// פורסמו" (which items). EXPANDABLE maps a signal id to the detail list it
// opens; every other signal keeps its original single-Link row untouched.
// The row's own action chip still navigates to the full page (a report, the
// editor) — expanding answers "what is this," the chip is still "go fix it."

const T = {
  title: 'מה דורש תשומת לב',
  demoOff: 'כיבוי',
  demoOffBusy: 'מכבה…',
  demoFailed: 'כיבוי מצב ההדגמה נכשל. נסה/י שוב.',
}

const SEVERITY: Record<SignalSeverity, { line: string; chip: string; ring: string }> = {
  critical: { line: '#ff6b6b', chip: 'rgba(255,107,107,0.13)', ring: 'rgba(255,107,107,0.32)' },
  warning:  { line: '#ffb240', chip: 'rgba(255,178,64,0.13)',  ring: 'rgba(255,178,64,0.32)' },
  info:     { line: '#60a5fa', chip: 'rgba(96,165,250,0.13)',  ring: 'rgba(96,165,250,0.32)' },
}

/** Which detail list a signal's id expands into, if any. Keyed by id rather
 *  than a flag on DashboardSignal itself — signals.ts stays a pure "what's
 *  true right now" module with no opinion about how the UI presents it. */
const EXPANDABLE: Record<string, (d: DashboardDetails) => ReactNode> = {
  'oms-stuck-items': (d) => <StuckItemsList rows={d.stuckItems} />,
  'menu-unpublished': (d) => <MenuChangesList rows={d.menuChanges} />,
}

export default function SignalStack({ signals, details, onDemoToggled }: {
  signals: DashboardSignal[]
  details: DashboardDetails
  /** Called after turning demo mode off succeeds — an immediate re-poll so
   *  this row disappears right away instead of waiting for the next 30s
   *  tick (see DashboardLive's own comment on why router.refresh() stopped
   *  reaching this once it lived inside a polled client component). */
  onDemoToggled?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  // The silence rule, enforced at the only place it can be enforced.
  if (signals.length === 0) return null

  // The MAX severity present, not the first row's. The stack is ordered by
  // `rank`, and although ranks are banded so a warning can never outrank a
  // critical, reading signals[0] made the header silently depend on that
  // invariant holding forever — one mis-banded rank added later and the
  // header would announce "warning" over a critical row. Taking the max
  // costs one pass and cannot drift.
  const tone = SEVERITY[
    signals.some((s) => s.severity === 'critical') ? 'critical'
      : signals.some((s) => s.severity === 'warning') ? 'warning'
      : 'info'
  ]

  async function turnDemoOff() {
    haptic()
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omsOverallDemoMode: false }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.demoFailed)
      onDemoToggled?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : T.demoFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rise" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
        <span style={{ fontSize: '1.02rem' }} aria-hidden>🔔</span>
        <h2 style={{ fontSize: '0.97rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          {T.title}
        </h2>
        <span style={{
          marginInlineStart: 'auto', borderRadius: 999, padding: '2px 9px',
          fontSize: '0.73rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: tone.line, background: tone.chip, border: `1px solid ${tone.ring}`,
        }}>{signals.length}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {signals.map((s, i) => (
          <SignalRow
            key={s.id}
            signal={s}
            delay={Math.min(i, 6) * 45}
            busy={busy}
            onDemoOff={turnDemoOff}
            renderDetail={EXPANDABLE[s.id]}
            details={details}
            open={openId === s.id}
            onToggle={() => setOpenId((cur) => (cur === s.id ? null : s.id))}
          />
        ))}
      </div>

      {error && (
        <p style={{ color: '#ff6b6b', fontSize: '0.78rem', margin: '9px 2px 0', lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  )
}

function SignalRow({ signal, delay, busy, onDemoOff, renderDetail, details, open, onToggle }: {
  signal: DashboardSignal
  delay: number
  busy: boolean
  onDemoOff: () => void
  renderDetail?: (d: DashboardDetails) => ReactNode
  details: DashboardDetails
  open: boolean
  onToggle: () => void
}) {
  const tone = SEVERITY[signal.severity]
  const body = (
    <>
      <span style={{ fontSize: '1rem', flex: '0 0 auto' }} aria-hidden>{signal.icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: '0.87rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>
          {signal.title}
        </b>
        {signal.detail && (
          <small style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 1, lineHeight: 1.4 }}>
            {signal.detail}
          </small>
        )}
      </span>
    </>
  )

  const shared: CSSProperties = {
    ...row,
    borderInlineStartColor: tone.line,
    animationDelay: `${delay}ms`,
  }

  if (signal.kind === 'demo-off') {
    return (
      <button
        type="button" onClick={onDemoOff} disabled={busy}
        className="rise press"
        style={{ ...shared, font: 'inherit', textAlign: 'start', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}
      >
        {body}
        <span style={action} aria-hidden>{busy ? T.demoOffBusy : signal.actionLabel}</span>
      </button>
    )
  }

  if (renderDetail) {
    // Two sibling controls, not one nested inside the other (a <Link> inside
    // a <button> is invalid and unreachable by keyboard either way): the row
    // body TOGGLES the detail open, the chip at the end still NAVIGATES —
    // expanding answers "what is this," the chip is still "go fix it."
    return (
      <div className="rise" style={{ ...shared, flexDirection: 'column', alignItems: 'stretch', gap: 0, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px' }}>
          <button
            type="button" className="press" onClick={onToggle} aria-expanded={open}
            style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'start', cursor: 'pointer' }}
          >
            {body}
            <span aria-hidden style={{ flex: '0 0 auto', color: 'var(--text-faint)', fontSize: '0.8rem', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s var(--ease)' }}>
              ▾
            </span>
          </button>
          {signal.href && (
            <Link href={signal.href} style={{ ...action, textDecoration: 'none', flex: '0 0 auto' }}>
              {signal.actionLabel}
            </Link>
          )}
        </div>
        {open && (
          <div className="rise" style={{ padding: '0 11px 11px' }}>
            {renderDetail(details)}
          </div>
        )}
      </div>
    )
  }

  // The whole row is the target, not just the chip at the end — this is read
  // one-handed on a phone mid-service, and a 60px pill is the wrong tap area
  // for the most urgent thing on the screen.
  return (
    <Link href={signal.href ?? '#'} className="rise press" style={{ ...shared, textDecoration: 'none' }}>
      {body}
      <span style={action} aria-hidden>{signal.actionLabel}</span>
    </Link>
  )
}

const card: CSSProperties = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 16,
  padding: '13px 13px 13px',
  marginBottom: 16,
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  background: 'var(--bg-elev-2)',
  border: '1px solid var(--line)',
  borderInlineStartWidth: 3,
  borderInlineStartStyle: 'solid',
  borderRadius: 11,
  padding: '9px 11px',
  color: 'var(--text)',
}

const action: CSSProperties = {
  flex: '0 0 auto',
  fontSize: '0.73rem',
  fontWeight: 700,
  color: 'var(--neon-soft)',
  border: '1px solid rgba(255,138,92,0.3)',
  background: 'rgba(255,138,92,0.09)',
  borderRadius: 9,
  padding: '5px 9px',
  whiteSpace: 'nowrap',
}
