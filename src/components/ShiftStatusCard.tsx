import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { ShiftStatusData } from '@/lib/owner/shift-status'
import { fmtDuration } from '@/lib/shifts/time'

// "the dashboard should have a container for shift that gives stats on last
// shift and notifies you when the new shift will start," 2026-08-30.
//
// Purely informational — the actual פתיחת/סיום משמרת buttons stay on
// /owner/reports, the one place that mutates waiter_shift_sessions. This
// card (and SignalStack's own shift-starting-soon/shift-not-started alerts,
// which read the exact same schedule data) only ever LINKS there; duplicating
// the open/close action here would be a second place that could get the
// self-lockout/open-tables/stuck-items guards out of sync with the real one.
//
// Three states, not a spinner: active (a session is genuinely running right
// now), idle-with-history (nothing running, but there's a last shift and/or
// a next one to report), and unknown (a read failed — never rendered as a
// confident "no shift", per this whole dashboard's own rule about failures).

const T = {
  title: 'משמרת',
  active: 'משמרת פעילה',
  activeSince: 'פתוחה כבר',
  lastShift: 'המשמרת האחרונה',
  noLastShift: 'אין עדיין היסטוריית משמרות',
  nextShift: 'המשמרת הבאה',
  nextToday: (start: string) => `היום ב-${start}`,
  nextTomorrow: (start: string) => `מחר ב-${start}`,
  noNextShift: 'אין משמרת מתוכננת בסידור העבודה',
  startsIn: (m: number) => m <= 0 ? 'עכשיו' : `בעוד ${m} דק׳`,
  toReports: 'לדוחות ומשמרות',
}

function heTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

export default function ShiftStatusCard({ status }: { status: ShiftStatusData }) {
  if (!status.known) return null // a failed read says nothing, never a confident "no shift"

  return (
    <Link href="/owner/reports" className="rise press" style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span aria-hidden style={{ fontSize: '1.1rem' }}>{status.active ? '🟢' : '⏸️'}</span>
        <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</span>
        {status.active && (
          <span style={liveDot} aria-hidden />
        )}
      </div>

      {status.active ? (
        <div style={row}>
          <b style={{ color: 'var(--text)' }}>{T.active}</b>
          <span style={dim}>
            {T.activeSince} {fmtDuration(status.active.minutesActive)}
            {status.active.startedByName && ` · ${status.active.startedByName}`}
          </span>
        </div>
      ) : (
        <>
          <div style={row}>
            <span style={dim}>{T.lastShift}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>
              {status.lastShift
                ? `${heTime(status.lastShift.startedAt)}–${heTime(status.lastShift.endedAt)} (${status.lastShift.durationLabel} ש׳)`
                : T.noLastShift}
            </span>
          </div>
          <div style={row}>
            <span style={dim}>{T.nextShift}</span>
            <span style={{ color: status.nextShift ? 'var(--text)' : 'var(--text-dim)', fontSize: '0.82rem', fontWeight: status.nextShift ? 700 : 400 }}>
              {status.nextShift
                ? `${status.nextShift.when === 'today' ? T.nextToday(status.nextShift.start) : T.nextTomorrow(status.nextShift.start)} · ${T.startsIn(status.nextShift.startsInMinutes)}`
                : T.noNextShift}
            </span>
          </div>
        </>
      )}

      <span style={{ fontSize: '0.74rem', color: 'var(--neon-soft)', fontWeight: 700, marginTop: 2 }}>
        {T.toReports} ←
      </span>
    </Link>
  )
}

const card: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 16,
  padding: '13px 14px', marginBottom: 16, textDecoration: 'none',
}

const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }
const dim: CSSProperties = { fontSize: '0.82rem', color: 'var(--text-faint)' }

const liveDot: CSSProperties = {
  width: 7, height: 7, borderRadius: 999, background: '#4ade80',
  boxShadow: '0 0 8px 1px rgba(74,222,128,0.7)', marginInlineStart: 'auto',
}
