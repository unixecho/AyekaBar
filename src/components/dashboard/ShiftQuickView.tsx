'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { addDays, dayNameHe, weekdayOf } from '@/lib/shifts/wall'
import {
  SHIFT_ENDING_MINUTES, SHIFT_SOON_MINUTES, fmtShiftRange, myShiftState, zonedNow,
  type PresenceShift, type ZonedNow,
} from '@/lib/shifts/presence'

// The staff dashboard's "my shifts" quick view (owner, 2026-10-13: "make sure
// the staff's dashboard has their quickview for shifts").
//
// A client component for one reason: the countdown must keep moving without a
// page refresh. The server hands over the viewer's OWN upcoming published
// shifts (src/lib/staff/my-shifts.ts strips everyone else's), and this
// recomputes the answer from the clock every 30 seconds with the same pure
// functions the Z-report gate and the waiter-call rule use.
//
// THREE honest states, and the empty one matters most: the bar is not using
// the scheduler yet, so for now almost everyone lands on "no shifts" — which
// must read as "nothing is scheduled", not as an error and not as a bug.

const TICK_MS = 30_000

/** 75 → "שעה ו-15 דק׳"; 45 → "45 דק׳"; 180 → "3 שעות". */
export function humanMinutes(m: number): string {
  const mins = Math.max(0, Math.round(m))
  if (mins < 60) return `${mins} דק׳`
  const h = Math.floor(mins / 60)
  const rest = mins % 60
  const hours = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`
  return rest === 0 ? hours : `${hours} ו-${rest} דק׳`
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'היום'
  if (date === addDays(today, 1)) return 'מחר'
  return `יום ${dayNameHe(weekdayOf(date))}`
}

/** A time range read left-to-right in every language: in an RTL line the
 *  default bidi order shows "13:54–17:54" as 17:54 on the left, which reads as
 *  a range running backwards. The isolate keeps start → end. */
function Range({ s }: { s: PresenceShift }) {
  return <bdi dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtShiftRange(s)}</bdi>
}

export default function ShiftQuickView({
  shifts, roleLabels, staffId, timezone, known, posOpen, initialNow,
}: {
  shifts: PresenceShift[]
  roleLabels: Record<string, string>
  staffId: string
  timezone: string
  /** False when the schedule could not be read at all. */
  known: boolean
  /** Is the POS's manual shift session open right now? null = unknown. */
  posOpen: boolean | null
  /** The SERVER's reading of "now". The first client render must use it, not
   *  its own clock: two clock reads a second apart can straddle a minute and
   *  produce different text on server and client (a hydration mismatch). */
  initialNow: ZonedNow
}) {
  const [now, setNow] = useState<ZonedNow>(initialNow)
  useEffect(() => {
    const tick = () => setNow(zonedNow(timezone))
    tick()
    const id = window.setInterval(tick, TICK_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [timezone])

  const state = useMemo(() => myShiftState(shifts, staffId, now, 4), [shifts, staffId, now])
  const roleOf = (s: PresenceShift) => {
    const id = s.assignments?.[0]?.roleId
    return id ? roleLabels[id] ?? id : null
  }

  const cur = state.current
  const next = state.next

  let tone: 'live' | 'soon' | 'idle' | 'unknown' = 'idle'
  let headline = 'אין לך משמרות מתוכננות'
  let detail: ReactNode = 'ברגע שיפורסם סידור עבודה ותשובצ/י, המשמרות שלך יופיעו כאן.'

  if (!known) {
    tone = 'unknown'
    headline = 'לא הצלחנו לטעון את הסידור'
    detail = 'נסו לרענן את העמוד. אפשר גם לפתוח את "המשמרות שלי" ישירות.'
  } else if (cur) {
    tone = 'live'
    headline = 'את/ה במשמרת עכשיו'
    detail = <><Range s={cur} /> · מסתיימת בעוד {humanMinutes(state.endsInMinutes ?? 0)}</>
    if ((state.endsInMinutes ?? 99) <= SHIFT_ENDING_MINUTES) headline = 'המשמרת שלך מסתיימת בקרוב'
  } else if (next) {
    const mins = state.startsInMinutes ?? 0
    tone = mins <= SHIFT_SOON_MINUTES ? 'soon' : 'idle'
    headline = mins <= SHIFT_SOON_MINUTES ? 'המשמרת שלך מתחילה בקרוב' : 'המשמרת הבאה שלך'
    detail = <>{dayLabel(next.date, now.date)} · <Range s={next} /> · בעוד {humanMinutes(mins)}</>
  }

  const accent =
    tone === 'live' ? '#4ade80' : tone === 'soon' ? '#fbbf24' : tone === 'unknown' ? '#ff6b6b' : 'var(--text-faint)'
  const role = cur ? roleOf(cur) : next ? roleOf(next) : null
  // The list below shows what comes AFTER the one in the headline.
  const rest = (cur ? state.upcoming : state.upcoming.slice(1)).slice(0, 3)

  return (
    <section
      aria-label="המשמרות שלי — תצוגה מהירה"
      className="rise"
      style={{
        background: 'var(--bg-elev)', border: `1px solid ${tone === 'live' ? 'rgba(74,222,128,0.4)' : 'var(--line)'}`,
        borderRadius: 18, padding: '16px', textAlign: 'start', animationDelay: '90ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{
          width: 10, height: 10, borderRadius: 999, background: accent, flex: '0 0 auto',
          boxShadow: tone === 'live' ? '0 0 10px rgba(74,222,128,0.8)' : 'none',
        }} />
        <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>{headline}</h2>
        {role && (
          <span style={{
            marginInlineStart: 'auto', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-dim)',
            border: '1px solid var(--line-strong)', borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap',
          }}>{role}</span>
        )}
      </div>

      {detail && (
        <p style={{ margin: '8px 0 0', fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>{detail}</p>
      )}

      {rest.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: '10px 0 0', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rest.map((s) => (
            <li key={s.id ?? `${s.date}${s.start}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.82rem', color: 'var(--text-dim)' }}>
              <span>{dayLabel(s.date, now.date)}</span>
              <Range s={s} />
            </li>
          ))}
        </ul>
      )}

      {/* The POS's own shift switch is a SEPARATE fact from the schedule — a
          person can be rostered for a night the bar has not opened. Showing
          both side by side is what "the POS is synced with the schedule"
          means on this screen. */}
      {posOpen !== null && (
        <p style={{ margin: '12px 0 0', fontSize: '0.76rem', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: posOpen ? '#4ade80' : 'var(--text-faint)' }} />
          {posOpen ? 'המשמרת במערכת הקופה פתוחה' : 'המשמרת במערכת הקופה עדיין לא נפתחה'}
        </p>
      )}

      <Link href="/staff/schedule" className="press" style={{
        display: 'inline-block', marginTop: 12, fontSize: '0.82rem', fontWeight: 600,
        color: 'var(--neon-soft)', textDecoration: 'none',
      }}>
        לכל הסידור ←
      </Link>
    </section>
  )
}
