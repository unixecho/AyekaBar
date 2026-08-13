'use client'

import { useShifts } from '@/components/shifts/ShiftsProvider'
import { dayNumeric, dayShort, weekDates, weekdayOf } from '@/lib/shifts/time'
import { forShift, worst, type Warning } from '@/lib/shifts/rules'
import type { Assignment, ISODate, Shift } from '@/lib/shifts/types'

// The week, drawn once and reused three times: the manager's builder (with
// every affordance), the staff view (read-only, own shifts lit up) and the
// print sheet (read-only, no affordances at all).
//
// Keeping it one component rather than three is what guarantees the paper
// matches the screen. A separate print renderer is exactly how a schedule ends
// up saying two different things — and the printed one is the one taped to the
// wall, so it is the one people believe.

export interface WeekGridProps {
  weekStart: ISODate
  shifts: Shift[]
  assignments: Assignment[]
  dayNotes: Record<ISODate, string>
  /** Manager only. Absent = read-only. */
  onShiftClick?: (shift: Shift) => void
  onAddShift?: (date: ISODate) => void
  onDayNote?: (date: ISODate) => void
  warnings?: Warning[]
  /** Draws this person's chips in their own colour and everyone else's muted. */
  highlightStaffId?: string | null
  /** Hide shifts this person is not on. */
  onlyStaffId?: string | null
}

export default function WeekGrid({
  weekStart, shifts, assignments, dayNotes,
  onShiftClick, onAddShift, onDayNote, warnings = [],
  highlightStaffId = null, onlyStaffId = null,
}: WeekGridProps) {
  const { db, t, lang, today } = useShifts()
  const { settings } = db

  return (
    <div className="sh-week">
      {weekDates(weekStart).map((date) => {
        const weekday = weekdayOf(date)
        const closed = !settings.workingDays.includes(weekday)
        const note = dayNotes[date]

        let dayShifts = shifts
          .filter((s) => s.date === date)
          .sort((a, b) => a.start.localeCompare(b.start))

        if (onlyStaffId) {
          const mine = new Set(assignments.filter((a) => a.staffId === onlyStaffId).map((a) => a.shiftId))
          dayShifts = dayShifts.filter((s) => mine.has(s.id))
        }

        return (
          <div key={date} className="sh-day" data-closed={closed} data-today={date === today}>
            <div className="sh-dayhead">
              <span className="sh-dayname">{dayShort(weekday, lang)}</span>
              <span className="sh-daydate">{dayNumeric(date)}</span>
            </div>

            {closed && !dayShifts.length && (
              <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-faint)' }}>{t('closedDay')}</p>
            )}

            {note && (
              <button
                type="button"
                onClick={onDayNote ? () => onDayNote(date) : undefined}
                disabled={!onDayNote}
                style={{
                  textAlign: 'start', font: 'inherit', fontSize: '0.72rem', lineHeight: 1.5,
                  color: 'var(--neon-2)', background: 'rgba(56,225,255,0.08)',
                  border: '1px solid rgba(56,225,255,0.22)', borderRadius: 10,
                  padding: '6px 8px', cursor: onDayNote ? 'pointer' : 'default',
                }}
              >
                📌 {note}
              </button>
            )}

            {dayShifts.map((shift) => (
              <ShiftCard
                key={shift.id}
                shift={shift}
                assignments={assignments.filter((a) => a.shiftId === shift.id)}
                warnings={forShift(warnings, shift.id)}
                onClick={onShiftClick}
                highlightStaffId={highlightStaffId}
              />
            ))}

            {!dayShifts.length && !closed && !onAddShift && (
              <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-faint)' }}>{t('emptyDay')}</p>
            )}

            {onAddShift && (
              <button type="button" className="sh-slot sh-noprint press" onClick={() => onAddShift(date)}>
                <span aria-hidden>＋</span>{t('addShift')}
              </button>
            )}

            {onDayNote && !note && (
              <button
                type="button" className="sh-noprint"
                onClick={() => onDayNote(date)}
                style={{
                  font: 'inherit', fontSize: '0.7rem', color: 'var(--text-faint)',
                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                  textAlign: 'start',
                }}
              >
                {`📌 ${t('dayNote')}`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ShiftCard({
  shift, assignments, warnings, onClick, highlightStaffId,
}: {
  shift: Shift
  assignments: Assignment[]
  warnings: Warning[]
  onClick?: (shift: Shift) => void
  highlightStaffId: string | null
}) {
  const { db, t, tri } = useShifts()
  const preset = db.settings.presets.find((p) => p.id === shift.presetId)
  const station = db.settings.stations.find((s) => s.id === shift.stationId)
  const severity = worst(warnings)
  const interactive = !!onClick

  const body = (
    <>
      <div className="sh-cardhead">
        <span className="sh-time">{shift.start}–{shift.end}</span>
        {preset && (
          <span className="sh-preset" style={{
            color: preset.color, background: `${preset.color}18`,
            border: `1px solid ${preset.color}40`,
          }}>
            {tri(preset.name)}
          </span>
        )}
        {severity && (
          <span
            aria-hidden
            style={{ marginInlineStart: 'auto', fontSize: '0.8rem' }}
            title={warnings.map((w) => tri(w.message)).join('\n')}
          >
            {severity === 'error' ? '⛔' : severity === 'warn' ? '⚠️' : 'ℹ️'}
          </span>
        )}
      </div>

      {station && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-faint)' }}>
          {station.emoji} {tri(station.name)}
        </span>
      )}

      {assignments.length ? (
        <div className="sh-people">
          {assignments.map((a) => (
            <PersonChip
              key={a.id} assignment={a}
              muted={!!highlightStaffId && a.staffId !== highlightStaffId}
            />
          ))}
        </div>
      ) : (
        <span style={{ fontSize: '0.72rem', color: '#ff6b6b', fontWeight: 600 }}>
          {t('unassigned')}
        </span>
      )}

      {shift.note && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', lineHeight: 1.45 }}>
          {shift.note}
        </span>
      )}
    </>
  )

  if (!interactive) {
    return <div className="sh-card" data-severity={severity ?? undefined} style={{ cursor: 'default' }}>{body}</div>
  }
  return (
    <button
      type="button" className="sh-card press"
      data-severity={severity ?? undefined}
      onClick={() => onClick?.(shift)}
    >
      {body}
    </button>
  )
}

export function PersonChip({ assignment, muted = false }: { assignment: Assignment; muted?: boolean }) {
  const { db, tri } = useShifts()
  const person = db.staff.find((s) => s.id === assignment.staffId)
  const role = db.settings.roles.find((r) => r.id === assignment.roleId)
  const colour = person?.colour ?? 'var(--text-faint)'
  const initial = person?.initial ?? person?.name?.[0] ?? '?'

  return (
    <span
      className="sh-chip"
      data-swap={assignment.status === 'swap_pending'}
      style={muted ? undefined : { borderColor: `${colour}55`, color: 'var(--text)' }}
      title={role ? tri(role.name) : undefined}
    >
      <span className="sh-dot" style={{ background: muted ? 'var(--line-strong)' : colour }} aria-hidden>
        {initial}
      </span>
      <span className="sh-chipname">{person?.name ?? '—'}</span>
      {role && <span aria-hidden style={{ opacity: 0.75 }}>{role.emoji}</span>}
    </span>
  )
}
