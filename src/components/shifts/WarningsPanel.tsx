'use client'

import { useShifts } from '@/components/shifts/ShiftsProvider'
import { summarize, type Warning } from '@/lib/shifts/rules'
import type { Shift } from '@/lib/shifts/types'

// The safety report for the open week.
//
// Every line is a button that jumps to the shift it is about. A warning you
// cannot act on from where you are reading it is a warning that gets ignored —
// and these are precisely the ones that must not be.

const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' } as const

export default function WarningsPanel({
  warnings, shifts, onOpenShift,
}: {
  warnings: Warning[]
  shifts: Shift[]
  onOpenShift?: (shift: Shift) => void
}) {
  const { t, tri, db } = useShifts()
  const counts = summarize(warnings)

  if (!warnings.length) {
    return (
      <div className="sh-panel" style={{ textAlign: 'center', padding: '28px 16px' }}>
        <div aria-hidden style={{ fontSize: '1.8rem', marginBottom: 8 }}>✅</div>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-dim)' }}>{t('noWarnings')}</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Count label={t('errorsLabel')} value={counts.errors} color="#ff6b6b" />
        <Count label={t('warnsLabel')} value={counts.warns} color="#fbbf24" />
        <Count label={t('infosLabel')} value={counts.infos} color="var(--text-dim)" />
      </div>

      {warnings.map((w) => {
        const shift = shifts.find((s) => w.shiftIds.includes(s.id))
        const person = w.staffId ? db.staff.find((s) => s.id === w.staffId) : null
        const clickable = !!shift && !!onOpenShift

        return (
          <button
            key={w.id}
            type="button"
            className={`sh-warn${clickable ? ' press' : ''}`}
            data-severity={w.severity}
            disabled={!clickable}
            onClick={clickable ? () => onOpenShift!(shift!) : undefined}
            style={clickable ? undefined : { cursor: 'default' }}
          >
            <span className="sh-warn-icon" aria-hidden>{ICON[w.severity]}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="sh-warn-text" style={{ display: 'block' }}>{tri(w.message)}</span>
              <span style={{ display: 'block', marginTop: 3, fontSize: '0.7rem', color: 'var(--text-faint)' }}>
                {[w.date, shift && `${shift.start}–${shift.end}`, person?.name]
                  .filter(Boolean).join(' · ')}
              </span>
            </span>
            {clickable && <span aria-hidden style={{ opacity: 0.5, fontSize: '0.8rem' }}>›</span>}
          </button>
        )
      })}
    </div>
  )
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '6px 12px', borderRadius: 999,
      border: '1px solid var(--line)', background: 'var(--bg-elev)',
      fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)',
    }}>
      <span style={{ color, fontWeight: 800, fontSize: '0.9rem' }}>{value}</span>
      {label}
    </span>
  )
}
