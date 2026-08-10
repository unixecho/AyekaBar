'use client'

import WheelPicker, { WHEEL_ITEM_H } from '@/components/WheelPicker'

// An hour:minute pair of clock wheels, speaking "HH:MM" in and out — the one
// time control for the whole owner panel. Menu timers, the automatic version
// schedule and Happy Hour all set a time of day, and they used to do it three
// different ways (a 24-button grid twice, wheels once).

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const pad = (n: number) => String(n).padStart(2, '0')

export function parseHhmm(value: string): { h: number; m: number } {
  const [h, m] = (value ?? '').split(':').map(Number)
  return {
    h: Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 0,
    m: Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0,
  }
}

export const fmtHhmm = (h: number, m: number) => `${pad(h)}:${pad(m)}`

export default function TimeWheel({
  value, onChange, minuteStep = 5, hourLabel = 'שעה', minuteLabel = 'דקה', disabled = false,
}: {
  /** "HH:MM", 24-hour. */
  value: string
  onChange: (next: string) => void
  minuteStep?: number
  hourLabel?: string
  minuteLabel?: string
  disabled?: boolean
}) {
  const { h, m } = parseHhmm(value)

  // The step list, plus the current minute when it isn't on a step. Happy Hour
  // has shipped with an end of 23:59 since it was built; without this, merely
  // opening the wizard and saving would quietly move it to 23:55.
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep)
  if (!minutes.includes(m)) minutes.push(m)
  minutes.sort((a, b) => a - b)

  return (
    <div className="tw" data-disabled={disabled ? 'true' : undefined}>
      <div aria-hidden className="tw-band" style={{ height: WHEEL_ITEM_H }} />
      <div className="tw-row" dir="ltr">
        <WheelPicker
          values={HOURS} value={h} disabled={disabled}
          onChange={(nh) => onChange(fmtHhmm(nh, m))}
          ariaLabel={hourLabel} format={pad}
        />
        <span aria-hidden className="tw-colon">:</span>
        <WheelPicker
          values={minutes} value={m} disabled={disabled}
          onChange={(nm) => onChange(fmtHhmm(h, nm))}
          ariaLabel={minuteLabel} format={pad}
        />
      </div>
    </div>
  )
}
