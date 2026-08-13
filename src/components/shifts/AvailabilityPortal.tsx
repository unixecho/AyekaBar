'use client'

import { useMemo, useState } from 'react'
import TimeWheel from '@/components/TimeWheel'
import SegmentedControl from '@/components/shifts/SegmentedControl'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { dayName, dayNumeric, weekDates, weekdayOf } from '@/lib/shifts/time'
import type { AvailabilityEntry, AvailabilityKind, ISODate } from '@/lib/shifts/types'

// Where an employee says what they can and cannot work, for a week that has
// not been built yet.
//
// Three states per day rather than a free-text box, because free text has to
// be read and interpreted by a human at exactly the moment they are trying to
// think about something else. `available` is the absence of a record — the
// default is that you can work, and only the exceptions are stored.
//
// The whole surface is behind ENABLE_AVAILABILITY_SUBMISSIONS, off by default:
// Ayeka Bar's manager did not ask for it, and a portal that collects
// submissions nobody reads is worse than no portal.

const KINDS: AvailabilityKind[] = ['unavailable', 'partial', 'prefer']

export default function AvailabilityPortal({ weekStart }: { weekStart: ISODate }) {
  const { db, t, lang, viewer, dispatch } = useShifts()
  const staffId = viewer.staffId

  const existing = useMemo(
    () => db.availability.find((a) => a.staffId === staffId && a.weekStart === weekStart) ?? null,
    [db.availability, staffId, weekStart])

  const [entries, setEntries] = useState<AvailabilityEntry[]>(() => existing?.entries.map((e) => ({ ...e })) ?? [])
  const [note, setNote] = useState(existing?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(existing?.submittedAt ?? null)

  if (!db.settings.features.ENABLE_AVAILABILITY_SUBMISSIONS) {
    return (
      <div className="sh-panel">
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{t('availability')}</h3>
        <p className="sh-sub" style={{ margin: '6px 0 0' }}>{t('featureOff')}</p>
      </div>
    )
  }

  if (!staffId) return null

  const entryFor = (date: ISODate) => entries.find((e) => e.date === date)

  function setKind(date: ISODate, kind: AvailabilityKind | 'available') {
    setEntries((prev) => {
      const rest = prev.filter((e) => e.date !== date)
      if (kind === 'available') return rest
      const previous = prev.find((e) => e.date === date)
      return [...rest, {
        date, kind,
        from: kind === 'partial' ? previous?.from ?? '18:00' : undefined,
        to: kind === 'partial' ? previous?.to ?? '23:00' : undefined,
      }].sort((a, b) => a.date.localeCompare(b.date))
    })
  }

  function setWindow(date: ISODate, patch: { from?: string; to?: string }) {
    setEntries((prev) => prev.map((e) => (e.date === date ? { ...e, ...patch } : e)))
  }

  async function submit() {
    setBusy(true)
    await dispatch({ type: 'availability.submit', staffId: staffId!, weekStart, entries, note })
    setBusy(false)
    setSavedAt(new Date().toISOString())
  }

  return (
    <section className="sh-panel">
      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>{t('availability')}</h3>
      <p className="sh-sub" style={{ margin: '4px 0 12px' }}>{t('availabilityIntro')}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {weekDates(weekStart).map((date) => {
          const entry = entryFor(date)
          const kind = entry?.kind ?? 'available'
          return (
            <div key={date} style={{
              padding: 10, borderRadius: 13,
              border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span className="sh-label">{dayName(weekdayOf(date), lang)}</span>
                <span className="sh-daydate">{dayNumeric(date)}</span>
              </div>

              <SegmentedControl<AvailabilityKind | 'available'>
                mode="radio"
                ariaLabel={`${dayName(weekdayOf(date), lang)} — ${t('availability')}`}
                value={kind}
                onChange={(next) => setKind(date, next)}
                options={[
                  { value: 'available', label: t('available') },
                  ...KINDS.map((k) => ({
                    value: k,
                    label: k === 'unavailable' ? t('unavailable') : k === 'partial' ? t('partial') : t('prefer'),
                  })),
                ]}
              />

              {kind === 'partial' && entry && (
                <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 120px' }}>
                    <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('startTime')}</p>
                    <TimeWheel value={entry.from ?? '18:00'} onChange={(v) => setWindow(date, { from: v })} />
                  </div>
                  <div style={{ flex: '1 1 120px' }}>
                    <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('endTime')}</p>
                    <TimeWheel value={entry.to ?? '23:00'} onChange={(v) => setWindow(date, { to: v })} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <textarea
        value={note} onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={t('notePlaceholder')}
        style={{
          width: '100%', marginTop: 12, padding: '10px 12px', borderRadius: 12, resize: 'vertical',
          border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
          color: 'var(--text)', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none',
        }}
      />

      <button
        type="button" className="press" disabled={busy} onClick={submit}
        style={{
          width: '100%', marginTop: 10, padding: '13px 0', borderRadius: 14, border: 'none',
          background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
          color: '#fff', font: 'inherit', fontSize: '0.92rem', fontWeight: 700,
          cursor: busy ? 'default' : 'pointer', boxShadow: 'var(--glow)',
        }}
      >
        {busy ? t('saving') : savedAt ? t('resubmit') : t('submitAvailability')}
      </button>

      {savedAt && (
        <p className="sh-sub" style={{ margin: '8px 0 0', textAlign: 'center' }}>
          ✓ {t('submitted')}
        </p>
      )}
    </section>
  )
}
