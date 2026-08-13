'use client'

import type { CSSProperties } from 'react'

// The safety-rule control. A slider rather than a number input because these
// four values are judgement calls a manager tunes by feel — "is eight hours of
// rest enough on a Friday?" — and dragging invites that, while a text field
// invites typing the first number that comes to mind and never revisiting it.
//
// The current value is rendered large beside the label rather than as a
// tooltip on the thumb: on a phone your thumb covers the thumb.

export default function NumberSlider({
  label, hint, value, min, max, step = 1, unit, onChange, disabled = false,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--line)', opacity: disabled ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="sh-label">{label}</span>
        <span style={{
          fontSize: '1.05rem', fontWeight: 800, color: 'var(--neon-soft)',
          direction: 'ltr', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        }}>
          {value}<span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-dim)', marginInlineStart: 3 }}>{unit}</span>
        </span>
      </div>

      {hint && <p className="sh-sub" style={{ margin: '2px 0 6px' }}>{hint}</p>}

      <input
        type="range"
        className="sh-slider"
        min={min} max={max} step={step} value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        // The filled part of the track is a gradient stop driven by this
        // variable — a pseudo-element can't be styled inline, and the track
        // pseudo-element is the only thing that paints behind the thumb.
        style={{ '--fill': `${pct}%` } as CSSProperties}
      />

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: '0.68rem', color: 'var(--text-faint)',
        direction: 'ltr', fontVariantNumeric: 'tabular-nums',
      }}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
