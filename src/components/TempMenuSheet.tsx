'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { barTimeMinutes, nextBarTimeInstant } from '@/lib/menu/variants'
import WheelPicker from '@/components/WheelPicker'
import Switch from '@/components/Switch'

// "The cook isn't in tonight — put the short menu up until 4am."
//
// One control, two ways in: the shortcut row sets the wheels, and the wheels
// set the deadline. Both end at the same place, an absolute instant, because
// the owner thinks in "another 4 hours" some nights and "until we close" on
// others, and neither should require doing arithmetic at the bar.
//
// The line at the bottom is the point of the whole sheet: it always spells out
// the day and time the menu comes back, so setting a timer at 1am and reading
// "מחר, 04:00" is a confirmation rather than a hope.

export interface TempSetting {
  /** Absolute ISO instant the version stops being live. */
  until: string
  /** Take the version away entirely once it's over — a one-off menu. */
  deleteOnExpiry: boolean
}

const T = {
  title: 'תפריט זמני',
  hintFor: (name: string) => `“${name}” יוצג עד השעה שתבחר/י, ואז התפריט יחזור לראשי לבד — בלי שאף אחד צריך לזכור.`,
  quick: 'לכמה זמן?',
  hours: (n: number) => (n === 1 ? 'שעה' : n === 2 ? 'שעתיים' : `${n} שעות`),
  untilLabel: 'עד השעה',
  hour: 'שעה',
  minute: 'דקה',
  revertsAt: 'התפריט יחזור לראשי',
  today: 'היום',
  tomorrow: 'מחר',
  inTime: (h: number, m: number) =>
    h && m ? `בעוד ${h} שעות ו-${m} דק׳`
      : h ? `בעוד ${h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`}`
        : `בעוד ${m} דק׳`,
  delTitle: 'למחוק את הגרסה בסיום',
  delHint: 'מתאים לתפריט חד-פעמי — כשהזמן נגמר הגרסה נעלמת מהרשימה במקום להצטבר בה.',
  keepHint: 'הגרסה תישאר ברשימה, מוכנה לפעם הבאה.',
  confirm: 'הפעלה',
  saveTimer: 'שמירת הזמן',
  cancel: 'ביטול',
  clear: 'ביטול התזמון',
  past: 'צריך לבחור זמן בעתיד',
}

const QUICK_HOURS = [2, 4, 6, 8]
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

const pad = (n: number) => String(n).padStart(2, '0')

export default function TempMenuSheet({
  variantName, initial, confirmLabel, allowClear = false, onCancel, onConfirm, onClear,
}: {
  variantName: string
  initial: TempSetting | null
  confirmLabel?: string
  /** Offer "drop the timer" — only meaningful when one is already running. */
  allowClear?: boolean
  onCancel: () => void
  onConfirm: (value: TempSetting) => void | Promise<void>
  onClear?: () => void | Promise<void>
}) {
  // Seed from the running timer, else a default of 04:00 — the end of a bar
  // night, and the case that prompted all this.
  const seed = initial ? new Date(initial.until) : null
  const seedBar = seed ? barClockOf(seed) : null

  const [hh, setHh] = useState(seedBar ? seedBar.h : 4)
  const [mm, setMm] = useState(seedBar ? nearestStep(seedBar.m) : 0)
  const [del, setDel] = useState(initial?.deleteOnExpiry ?? false)
  const [busy, setBusy] = useState(false)
  // Keeps "בעוד 3 שעות" honest while the sheet sits open.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onCancel, busy])

  const target = useMemo(
    () => nextBarTimeInstant(hh, mm),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hh, mm, tick],
  )

  const minutesAway = Math.max(0, Math.round((target.getTime() - Date.now()) / 60_000))
  const awayH = Math.floor(minutesAway / 60)
  const awayM = minutesAway % 60
  // nextBarTimeInstant already rolls past midnight for a time that's gone, so
  // "tomorrow" is simply whether it crosses one.
  const crossesMidnight = hh * 60 + mm <= barTimeMinutes()

  function pickQuick(hours: number) {
    const t = new Date(Date.now() + hours * 3_600_000)
    const bar = barClockOf(t)
    setHh(bar.h)
    setMm(nearestStep(bar.m))
  }

  async function confirm() {
    if (minutesAway < 1) return
    setBusy(true)
    try {
      await onConfirm({ until: target.toISOString(), deleteOnExpiry: del })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={T.title}
      onClick={() => !busy && onCancel()} className="sheet-scrim">
      <div onClick={(e) => e.stopPropagation()} className="sheet-panel">
        <div aria-hidden className="sheet-grabber" />

        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</h3>
        <p style={{ margin: '4px 0 14px', fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
          {T.hintFor(variantName)}
        </p>

        <div className="sheet-scroll">
          <div className="pick-cat" style={{ padding: 12 }}>
            <label style={labelStyle}>{T.quick}</label>
            <div className="hh-percent-grid">
              {QUICK_HOURS.map((h) => (
                <button key={h} type="button" className="press hh-percent-btn"
                  onClick={() => pickQuick(h)}>{T.hours(h)}</button>
              ))}
            </div>
          </div>

          <div className="pick-cat" style={{ padding: 12 }}>
            <label style={labelStyle}>{T.untilLabel}</label>
            <div className="wheel-row" dir="ltr">
              <WheelPicker values={HOURS} value={hh} onChange={setHh}
                ariaLabel={T.hour} format={pad} />
              <span aria-hidden className="wheel-colon">:</span>
              <WheelPicker values={MINUTES} value={mm} onChange={setMm}
                ariaLabel={T.minute} format={pad} />
            </div>

            <div className="temp-preview">
              <span className="temp-preview-label">{T.revertsAt}</span>
              <strong className="temp-preview-time" dir="ltr">
                {pad(hh)}:{pad(mm)}
              </strong>
              <span className="temp-preview-when">
                {crossesMidnight ? T.tomorrow : T.today}
                {minutesAway >= 1 && ` · ${T.inTime(awayH, awayM)}`}
              </span>
            </div>
          </div>

          <div className="pick-cat" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>{T.delTitle}</div>
                <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                  {del ? T.delHint : T.keepHint}
                </p>
              </div>
              <button type="button" role="switch" aria-checked={del} aria-label={T.delTitle}
                onClick={() => setDel((d) => !d)} className="press"
                style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
                <Switch on={del} />
              </button>
            </div>
          </div>
        </div>

        {minutesAway < 1 && <p style={errStyle}>{T.past}</p>}

        <div style={{ flex: '0 0 auto', paddingTop: 12 }}>
          <button type="button" onClick={confirm} disabled={busy || minutesAway < 1}
            className="press" style={{ ...primary, opacity: busy || minutesAway < 1 ? 0.6 : 1 }}>
            {confirmLabel ?? (initial ? T.saveTimer : T.confirm)}
          </button>
          {allowClear && onClear && (
            <button type="button" onClick={() => onClear()} disabled={busy} className="press"
              style={{ ...cancel, color: 'var(--neon-soft)' }}>
              {T.clear}
            </button>
          )}
          <button type="button" onClick={onCancel} disabled={busy} className="press" style={cancel}>
            {T.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** What the clock AT THE BAR reads at `d` — the owner's phone may be anywhere. */
function barClockOf(d: Date): { h: number; m: number } {
  const total = barTimeMinutes(d)
  return { h: Math.floor(total / 60), m: total % 60 }
}

/** Wheel minutes go in fives; a shortcut landing on 4:37 snaps to 4:35. */
function nearestStep(m: number): number {
  return MINUTES.reduce((best, v) => (Math.abs(v - m) < Math.abs(best - m) ? v : best), MINUTES[0])
}

const labelStyle: CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 700,
  color: 'var(--text-dim)', marginBottom: 7,
}
const errStyle: CSSProperties = { color: '#ff6b6b', fontSize: '0.82rem', margin: '10px 0 0' }
const primary: CSSProperties = {
  width: '100%', padding: '14px 0', borderRadius: 14, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  boxShadow: 'var(--glow)', color: '#fff', fontSize: '1rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const cancel: CSSProperties = {
  width: '100%', marginTop: 8, padding: '13px 0', borderRadius: 14,
  border: '1px solid var(--line)', background: 'transparent',
  color: 'var(--text-dim)', fontSize: '0.95rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
}
