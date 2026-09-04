'use client'

import { useState } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { summarize, type Warning } from '@/lib/shifts/rules'
import { WARNING_LABELS } from '@/lib/shifts/i18n'
import type { Shift } from '@/lib/shifts/types'

// The safety report for the open week.
//
// Every line is a button that jumps to the shift it is about. A warning you
// cannot act on from where you are reading it is a warning that gets ignored —
// and these are precisely the ones that must not be.
//
// GROUPED BY CODE (decision D11, phase 5) — a half-built week can produce
// dozens of individual warnings, and a flat list of them is exactly the
// "spam the manager" the owner asked this module not to do. Errors stay
// expanded (they are the ones that need eyes right now); warn groups
// collapse to a counted header; info groups sit behind one more
// disclosure. The OTHER two levers for the same problem live elsewhere:
// `settings.ruleSeverity` (rules.ts, applied once for the whole venue) and
// per-warning DISMISSAL, right here — a warning a manager has looked at and
// decided is fine stays out of the list until its underlying cause changes
// shape (a warning's `id` is derived from its own content, so a dismissal
// evaporates on its own rather than needing to be un-dismissed by hand).

const ICON = { error: '⛔', warn: '⚠️', info: 'ℹ️' } as const
const SEVERITY_COLOR = { error: '#ff6b6b', warn: '#fbbf24', info: 'var(--text-dim)' } as const

export default function WarningsPanel({
  warnings, shifts, dismissedWarnings, onOpenShift, onDismiss,
}: {
  warnings: Warning[]
  shifts: Shift[]
  /** Warning ids the manager has already acknowledged for this week — see
   *  `ScheduleWeek.dismissedWarnings`. */
  dismissedWarnings: string[]
  onOpenShift?: (shift: Shift) => void
  onDismiss: (warningId: string, dismissed: boolean) => void
}) {
  const { t, tri } = useShifts()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showInfo, setShowInfo] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)

  const dismissedSet = new Set(dismissedWarnings)
  const visible = warnings.filter((w) => !dismissedSet.has(w.id))
  const dismissed = warnings.filter((w) => dismissedSet.has(w.id))
  const counts = summarize(visible)

  // Insertion order over the already-severity-sorted `warnings` array puts
  // error-only groups first, then warn, then info — no re-sort needed.
  const groups = new Map<string, Warning[]>()
  for (const w of visible) {
    if (!groups.has(w.code)) groups.set(w.code, [])
    groups.get(w.code)!.push(w)
  }

  const toggleGroup = (code: string) => setExpanded((cur) => {
    const next = new Set(cur)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })

  if (!visible.length) {
    return (
      <div className="sh-panel" style={{ textAlign: 'center', padding: '28px 16px' }}>
        <div aria-hidden style={{ fontSize: '1.8rem', marginBottom: 8 }}>✅</div>
        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-dim)' }}>{t('noWarnings')}</p>
        {!!dismissed.length && (
          <button type="button" className="press" onClick={() => setShowDismissed(true)} style={linkButton}>
            {t('showDismissed').replace('{n}', String(dismissed.length))}
          </button>
        )}
        {showDismissed && (
          <div style={{ marginTop: 14, textAlign: 'start' }}>
            {dismissed.map((w) => (
              <WarningRow key={w.id} w={w} shifts={shifts} dismissed onDismiss={onDismiss} onOpenShift={onOpenShift} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Count label={t('errorsLabel')} value={counts.errors} color={SEVERITY_COLOR.error} />
        <Count label={t('warnsLabel')} value={counts.warns} color={SEVERITY_COLOR.warn} />
        <Count label={t('infosLabel')} value={counts.infos} color={SEVERITY_COLOR.info} />
        {!!dismissed.length && (
          <button type="button" className="press" onClick={() => setShowDismissed((v) => !v)} style={linkButton}>
            {showDismissed ? t('hideDismissed') : t('showDismissed').replace('{n}', String(dismissed.length))}
          </button>
        )}
      </div>

      {Array.from(groups.entries()).map(([code, group]) => {
        const severity = group[0].severity
        // Errors: always expanded — these are the ones that need eyes now.
        // Warn: collapsed by default, one tap opens it.
        // Info: behind the global "show info notices" disclosure below,
        // then behaves like a warn group once revealed.
        if (severity === 'info' && !showInfo) return null
        const open = severity === 'error' || expanded.has(code)

        return (
          <div key={code} className="sh-panel" style={{ padding: 0, overflow: 'hidden' }}>
            <button
              type="button" className="press"
              onClick={severity === 'error' ? undefined : () => toggleGroup(code)}
              disabled={severity === 'error'}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '11px 12px', background: 'none', border: 'none', font: 'inherit',
                cursor: severity === 'error' ? 'default' : 'pointer', textAlign: 'start',
              }}
            >
              <span aria-hidden>{ICON[severity]}</span>
              <span style={{ flex: 1, fontSize: '0.86rem', fontWeight: 700, color: 'var(--text)' }}>
                {tri(WARNING_LABELS[code as keyof typeof WARNING_LABELS])}
              </span>
              <span style={{
                fontSize: '0.74rem', fontWeight: 800, color: SEVERITY_COLOR[severity],
                background: `${SEVERITY_COLOR[severity]}18`, borderRadius: 999, padding: '2px 8px',
              }}>
                {group.length}
              </span>
              {severity !== 'error' && (
                <span aria-hidden style={{ opacity: 0.5, fontSize: '0.8rem', transform: open ? 'rotate(90deg)' : undefined }}>
                  ›
                </span>
              )}
            </button>

            {open && (
              <div style={{ borderTop: '1px solid var(--line)' }}>
                {group.map((w) => (
                  <WarningRow key={w.id} w={w} shifts={shifts} onDismiss={onDismiss} onOpenShift={onOpenShift} />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {warnings.some((w) => w.severity === 'info') && !showInfo && (
        <button type="button" className="press" onClick={() => setShowInfo(true)} style={linkButton}>
          {t('showInfoNotices')}
        </button>
      )}

      {showDismissed && !!dismissed.length && (
        <div className="sh-panel" style={{ padding: '10px 12px' }}>
          <p className="sh-sub" style={{ margin: '0 0 6px' }}>{t('dismissedSectionTitle')}</p>
          {dismissed.map((w) => (
            <WarningRow key={w.id} w={w} shifts={shifts} dismissed onDismiss={onDismiss} onOpenShift={onOpenShift} />
          ))}
        </div>
      )}
    </div>
  )
}

function WarningRow({ w, shifts, dismissed = false, onDismiss, onOpenShift }: {
  w: Warning; shifts: Shift[]; dismissed?: boolean
  onDismiss: (warningId: string, dismissed: boolean) => void
  onOpenShift?: (shift: Shift) => void
}) {
  const { t, tri, db } = useShifts()
  const shift = shifts.find((s) => w.shiftIds.includes(s.id))
  const person = w.staffId ? db.staff.find((s) => s.id === w.staffId) : null
  const clickable = !!shift && !!onOpenShift

  return (
    <div className="sh-warn" data-severity={w.severity} style={{ opacity: dismissed ? 0.6 : 1 }}>
      <button
        type="button"
        className={clickable ? 'press' : undefined}
        disabled={!clickable}
        onClick={clickable ? () => onOpenShift!(shift!) : undefined}
        style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: 8,
          background: 'none', border: 'none', padding: 0, font: 'inherit', textAlign: 'start',
          cursor: clickable ? 'pointer' : 'default',
        }}
      >
        <span className="sh-warn-icon" aria-hidden>{ICON[w.severity]}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="sh-warn-text" style={{ display: 'block' }}>{tri(w.message)}</span>
          <span style={{ display: 'block', marginTop: 3, fontSize: '0.7rem', color: 'var(--text-faint)' }}>
            {[w.date, shift && `${shift.start}–${shift.end}`, person?.name].filter(Boolean).join(' · ')}
          </span>
        </span>
        {clickable && <span aria-hidden style={{ opacity: 0.5, fontSize: '0.8rem' }}>›</span>}
      </button>
      <button
        type="button" className="press"
        onClick={() => onDismiss(w.id, !dismissed)}
        title={dismissed ? t('restore') : t('dismiss')}
        // A11y (WCAG 4.1.2): title alone becomes the accessible DESCRIPTION,
        // not the name, once the button has real content — its accessible
        // name was falling back to the glyph itself ("↺"/"✕"). Worse than
        // the catalog editor's own glyph-button bug (that one at least set
        // aria-label) — found 2026-09-04.
        aria-label={dismissed ? t('restore') : t('dismiss')}
        style={{
          flex: '0 0 auto', border: 'none', background: 'none', cursor: 'pointer',
          color: 'var(--text-faint)', fontSize: '0.9rem', padding: '4px 6px',
        }}
      >
        <span aria-hidden>{dismissed ? '↺' : '✕'}</span>
      </button>
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

const linkButton: React.CSSProperties = {
  border: 'none', background: 'none', color: 'var(--text-dim)', fontSize: '0.78rem',
  fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', font: 'inherit', padding: '4px 2px',
}
