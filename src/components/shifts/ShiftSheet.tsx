'use client'

import { useMemo, useState, type ReactNode } from 'react'
import SheetShell, { sheetPrimary, sheetSecondary } from '@/components/shifts/SheetShell'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import TimeWheel from '@/components/TimeWheel'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { crossesMidnight, durationMinutes, fmtDuration } from '@/lib/shifts/time'
import type { ISODate, RoleRequirement, Shift } from '@/lib/shifts/types'

// One shift, opened from the grid. Creating and editing are the same sheet —
// creating just starts from a preset — because they are the same decision made
// at two different moments, and two sheets would drift.
//
// Times, station, staffing levels and the note are committed together on Save;
// assignments apply the instant you tap a name. That split is deliberate: a
// half-typed time is meaningless, while "put Dana on this shift" is a complete
// thought on its own, and making it wait behind a Save button is how you end
// up with a manager who assigns five people and loses all five.

export type ShiftSheetMode =
  | { type: 'create'; date: ISODate }
  | { type: 'edit'; shift: Shift }

export default function ShiftSheet({
  mode, weekStart, readOnly = false, onClose,
}: {
  mode: ShiftSheetMode
  weekStart: ISODate
  readOnly?: boolean
  onClose: () => void
}) {
  const { db, t, tri, dispatch } = useShifts()
  const { settings } = db

  const editing = mode.type === 'edit' ? mode.shift : null
  const date = mode.type === 'edit' ? mode.shift.date : mode.date

  const [presetId, setPresetId] = useState<string | null>(editing?.presetId ?? settings.presets[0]?.id ?? null)
  const basePreset = settings.presets.find((p) => p.id === presetId)

  const [start, setStart] = useState(editing?.start ?? basePreset?.start ?? '18:00')
  const [end, setEnd] = useState(editing?.end ?? basePreset?.end ?? '01:00')
  const [stationId, setStationId] = useState<string | null>(editing?.stationId ?? basePreset?.stationId ?? null)
  const [note, setNote] = useState(editing?.note ?? '')
  const [requirements, setRequirements] = useState<RoleRequirement[]>(
    editing?.requirements ?? basePreset?.requirements.map((r) => ({ ...r })) ?? [])
  const [openRole, setOpenRole] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [busy, setBusy] = useState(false)

  const assignments = useMemo(
    () => (editing ? db.assignments.filter((a) => a.shiftId === editing.id) : []),
    [db.assignments, editing])

  /** Switching preset re-seeds the whole shift, including any staffing levels
   *  you had already tuned. Only offered while creating, for that reason. */
  function applyPreset(id: string) {
    const preset = settings.presets.find((p) => p.id === id)
    setPresetId(id)
    if (!preset) return
    setStart(preset.start)
    setEnd(preset.end)
    setStationId(preset.stationId ?? null)
    setRequirements(preset.requirements.map((r) => ({ ...r })))
  }

  function setMin(roleId: string, delta: number) {
    setRequirements((prev) => {
      const found = prev.find((r) => r.roleId === roleId)
      if (!found) return delta > 0 ? [...prev, { roleId, min: 1 }] : prev
      const min = Math.max(0, found.min + delta)
      return min === 0
        ? prev.filter((r) => r.roleId !== roleId)
        : prev.map((r) => (r.roleId === roleId ? { ...r, min } : r))
    })
  }

  async function save() {
    setBusy(true)
    if (editing) {
      await dispatch({
        type: 'shift.update', shiftId: editing.id,
        patch: { start, end, stationId, note, requirements, presetId },
      })
    } else {
      await dispatch({
        type: 'shift.create', weekStart, date, presetId,
        start, end, stationId, requirements,
      })
    }
    setBusy(false)
    onClose()
  }

  const duration = durationMinutes(start, end)
  const title = editing
    ? `${t('edit')} · ${start}–${end}`
    : t('addShift')

  return (
    <>
      <SheetShell
        title={title}
        subtitle={`${date} · ${fmtDuration(duration)} ${t('hours')}`}
        onClose={onClose}
        wide
        footer={readOnly ? undefined : (
          <>
            <button type="button" className="press" style={sheetSecondary} onClick={onClose}>
              {t('cancel')}
            </button>
            <button
              type="button" className="press" style={sheetPrimary(!busy)}
              disabled={busy} onClick={save}
            >
              {busy ? t('saving') : t('save')}
            </button>
          </>
        )}
      >
        {/* ---- preset ---- */}
        {!editing && (
          <Section label={t('preset')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {settings.presets.map((p) => (
                <Pill
                  key={p.id} active={p.id === presetId} color={p.color}
                  onClick={() => applyPreset(p.id)}
                  label={`${tri(p.name)} · ${p.start}–${p.end}`}
                />
              ))}
              <Pill
                active={presetId === null} color="#a8a5b0"
                onClick={() => setPresetId(null)} label={t('customShift')}
              />
            </div>
          </Section>
        )}

        {/* ---- times ---- */}
        <Section label={`${t('startTime')} / ${t('endTime')}`}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 130px' }}>
              <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('startTime')}</p>
              <TimeWheel value={start} onChange={setStart} disabled={readOnly} />
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('endTime')}</p>
              <TimeWheel value={end} onChange={setEnd} disabled={readOnly} />
            </div>
          </div>
          {crossesMidnight(start, end) && (
            <p className="sh-sub" style={{ marginTop: 6, color: 'var(--neon-2)' }}>🌙 {t('overnight')}</p>
          )}
        </Section>

        {/* ---- station ---- */}
        <Section label={t('station')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {settings.stations.map((s) => (
              <Pill
                key={s.id} active={s.id === stationId} color="#38e1ff"
                onClick={() => setStationId(s.id === stationId ? null : s.id)}
                label={`${s.emoji} ${tri(s.name)}`}
              />
            ))}
            {!stationId && <Pill active color="#a8a5b0" onClick={() => {}} label={t('noStation')} />}
          </div>
        </Section>

        {/* ---- staffing ---- */}
        <Section label={t('requirements')}>
          {settings.roles.map((role) => {
            const req = requirements.find((r) => r.roleId === role.id)
            const placed = assignments.filter((a) => a.roleId === role.id)
            const short = (req?.min ?? 0) - placed.length
            const candidates = db.staff
              .filter((s) => s.active)
              .filter((s) => !placed.some((a) => a.staffId === s.id))
              // Someone whose job title already matches the role is the
              // obvious pick, so they come first rather than in alphabetical
              // order among people who cannot do the job.
              .sort((a, b) => Number(b.badge === role.badge) - Number(a.badge === role.badge))

            return (
              <div key={role.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden>{role.emoji}</span>
                  <span className="sh-label" style={{ flex: 1 }}>{tri(role.name)}</span>
                  {short > 0 && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#ff6b6b' }}>
                      −{short}
                    </span>
                  )}
                  <Stepper
                    value={req?.min ?? 0}
                    disabled={readOnly}
                    onChange={(delta) => setMin(role.id, delta)}
                  />
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {placed.map((a) => {
                    const person = db.staff.find((s) => s.id === a.staffId)
                    return (
                      <button
                        key={a.id} type="button" className="press"
                        disabled={readOnly}
                        onClick={() => setConfirm({
                          title: `${t('remove')} ${person?.name ?? ''}`,
                          body: `${tri(role.name)} · ${start}–${end}`,
                          confirmLabel: t('remove'),
                          onConfirm: () => { void dispatch({ type: 'assignment.delete', assignmentId: a.id }) },
                        })}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          padding: '5px 10px', borderRadius: 999, font: 'inherit',
                          fontSize: '0.78rem', fontWeight: 600, cursor: readOnly ? 'default' : 'pointer',
                          border: `1px solid ${person?.colour ?? 'var(--line-strong)'}55`,
                          background: `${person?.colour ?? '#666'}14`, color: 'var(--text)',
                        }}
                      >
                        {person?.name ?? '—'}
                        {!readOnly && <span aria-hidden style={{ opacity: 0.6 }}>✕</span>}
                      </button>
                    )
                  })}

                  {!readOnly && editing && (
                    <button
                      type="button" className="press"
                      onClick={() => setOpenRole(openRole === role.id ? null : role.id)}
                      style={{
                        padding: '5px 12px', borderRadius: 999, font: 'inherit',
                        fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
                        border: '1px dashed var(--line-strong)', background: 'transparent',
                        color: 'var(--text-dim)',
                      }}
                    >
                      ＋ {t('assign')}
                    </button>
                  )}
                </div>

                {openRole === role.id && editing && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {candidates.length ? candidates.map((person) => (
                      <button
                        key={person.id} type="button" className="press"
                        onClick={async () => {
                          await dispatch({
                            type: 'assignment.create', shiftId: editing.id,
                            staffId: person.id, roleId: role.id,
                          })
                          setOpenRole(null)
                        }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 7,
                          padding: '7px 12px', borderRadius: 12, font: 'inherit',
                          fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                          border: '1px solid var(--line)', background: 'var(--bg-elev)',
                          color: 'var(--text)',
                        }}
                      >
                        <span className="sh-dot" style={{ background: person.colour ?? 'var(--line-strong)' }} aria-hidden>
                          {person.initial ?? person.name[0]}
                        </span>
                        {person.name}
                        {person.badge === role.badge && <span aria-hidden style={{ opacity: 0.7 }}>✓</span>}
                      </button>
                    )) : (
                      <p className="sh-sub" style={{ margin: 0 }}>{t('noStaff')}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </Section>

        {/* ---- note ---- */}
        <Section label={t('shiftNote')}>
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')} rows={2} disabled={readOnly}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 12, resize: 'vertical',
              border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
              color: 'var(--text)', fontSize: '0.88rem', fontFamily: 'inherit', outline: 'none',
            }}
          />
        </Section>

        {editing && !readOnly && (
          <button
            type="button" className="press"
            onClick={() => setConfirm({
              title: t('deleteShift'),
              body: t('deleteShiftBody'),
              confirmLabel: t('remove'),
              onConfirm: () => { void dispatch({ type: 'shift.delete', shiftId: editing.id }).then(onClose) },
            })}
            style={{
              width: '100%', marginTop: 14, padding: '12px 0', borderRadius: 14,
              border: '1px solid rgba(255,107,107,0.35)', background: 'rgba(255,107,107,0.08)',
              color: '#ff6b6b', fontSize: '0.9rem', fontWeight: 700,
              fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {t('deleteShift')}
          </button>
        )}
      </SheetShell>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 16 }}>
      <h4 style={{
        margin: '0 0 8px', fontSize: '0.76rem', fontWeight: 700,
        color: 'var(--text-faint)', letterSpacing: '0.02em',
      }}>
        {label}
      </h4>
      {children}
    </section>
  )
}

function Pill({ active, color, label, onClick }: {
  active: boolean; color: string; label: string; onClick: () => void
}) {
  return (
    <button
      type="button" className="press" onClick={onClick}
      style={{
        padding: '7px 12px', borderRadius: 999, font: 'inherit',
        fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${active ? `${color}66` : 'var(--line)'}`,
        background: active ? `${color}1c` : 'var(--bg-elev)',
        color: active ? 'var(--text)' : 'var(--text-dim)',
      }}
    >
      {label}
    </button>
  )
}

function Stepper({ value, onChange, disabled }: {
  value: number; onChange: (delta: number) => void; disabled?: boolean
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, direction: 'ltr',
      border: '1px solid var(--line-strong)', borderRadius: 999, padding: 2,
    }}>
      <StepButton label="−" onClick={() => onChange(-1)} disabled={disabled || value === 0} />
      <span style={{
        minWidth: 22, textAlign: 'center', fontSize: '0.84rem',
        fontWeight: 700, fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </span>
      <StepButton label="＋" onClick={() => onChange(1)} disabled={disabled} />
    </span>
  )
}

function StepButton({ label, onClick, disabled }: {
  label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label}
      style={{
        width: 26, height: 26, borderRadius: 999, border: 'none',
        background: disabled ? 'transparent' : 'var(--bg-elev-2)',
        color: disabled ? 'var(--text-faint)' : 'var(--text)',
        font: 'inherit', fontSize: '0.9rem', fontWeight: 700,
        cursor: disabled ? 'default' : 'pointer', lineHeight: 1,
      }}
    >
      {label}
    </button>
  )
}
