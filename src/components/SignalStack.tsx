'use client'

import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { haptic } from '@/lib/haptics'
import type { DashboardSignal, SignalSeverity } from '@/lib/owner/signals'

// The dashboard's alert stack. Renders nothing at all when there is nothing to
// say — see the header of lib/owner/signals.ts for why that matters more than
// any styling decision in this file.
//
// Ordering is decided upstream (each signal carries a fixed `rank`), not here.
// A component that re-sorted by its own idea of urgency would make the stack
// jitter between two loads with identical contents.

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

export default function SignalStack({ signals }: { signals: DashboardSignal[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      // Re-read the server component so the row disappears — and so the
      // Overall view's own card updates in the same paint.
      router.refresh()
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

function SignalRow({ signal, delay, busy, onDemoOff }: {
  signal: DashboardSignal
  delay: number
  busy: boolean
  onDemoOff: () => void
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
      <span style={action} aria-hidden>
        {signal.kind === 'demo-off' && busy ? T.demoOffBusy : signal.actionLabel}
      </span>
    </>
  )

  // The whole row is the target, not just the chip at the end — this is read
  // one-handed on a phone mid-service, and a 60px pill is the wrong tap area
  // for the most urgent thing on the screen.
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
      </button>
    )
  }

  return (
    <Link href={signal.href ?? '#'} className="rise press" style={{ ...shared, textDecoration: 'none' }}>
      {body}
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
