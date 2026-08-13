'use client'

import { useEffect, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import Switch from '@/components/Switch'
import TimeWheel from '@/components/TimeWheel'
import NumberSlider from '@/components/shifts/NumberSlider'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { DEFAULT_ROLES, SAFETY_BOUNDS } from '@/lib/shifts/config'
import { dayName } from '@/lib/shifts/time'
import type { ShiftSettings } from '@/lib/shifts/types'

// First-run setup. Full screen, one decision per screen, in the order a
// manager actually thinks about them: when are we open → what does a shift
// look like → who works it → what counts as too much.
//
// Full screen rather than a sheet, for the same reason HappyHourWizard is:
// this is the whole task for the next two minutes, not an aside from something
// behind it. It is also NOT a gate — everything it collects is editable
// forever afterwards in Settings, and the last screen says so, because a setup
// wizard that feels permanent is a setup wizard people abandon.

const STEPS = ['days', 'hours', 'presets', 'team', 'safety', 'done'] as const
type Step = (typeof STEPS)[number]

export default function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const { db, t, tri, lang, dispatch } = useShifts()
  const [step, setStep] = useState<Step>('days')
  const [draft, setDraft] = useState<ShiftSettings>(() => structuredCloneish(db.settings))
  const [newStation, setNewStation] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const index = STEPS.indexOf(step)
  const patch = (next: Partial<ShiftSettings>) => setDraft((d) => ({ ...d, ...next }))

  async function finish() {
    setBusy(true)
    await dispatch({ type: 'onboarding.complete', patch: draft })
    setBusy(false)
    onDone()
  }

  return (
    <ModalPortal>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 160, background: 'var(--bg)',
        display: 'flex', flexDirection: 'column', animation: 'fade-in .24s var(--ease)',
      }}>
        {/* ---- progress ---- */}
        <div style={{ padding: '18px 20px 10px', flex: '0 0 auto' }}>
          <div style={{ display: 'flex', gap: 5, marginBottom: 14 }} aria-hidden>
            {STEPS.map((s, i) => (
              <span key={s} style={{
                flex: 1, height: 3, borderRadius: 999,
                background: i <= index
                  ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
                  : 'var(--bg-elev-2)',
                transition: 'background .3s var(--ease)',
              }} />
            ))}
          </div>
          <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: 'var(--text)' }}>
            {step === 'days' ? t('stepDays')
              : step === 'hours' ? t('stepHours')
              : step === 'presets' ? t('stepPresets')
              : step === 'team' ? t('stepRoles')
              : step === 'safety' ? t('stepSafety')
              : t('setupDone')}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
            {step === 'days' ? t('stepDaysHint')
              : step === 'hours' ? t('stepHoursHint')
              : step === 'presets' ? t('stepPresetsHint')
              : step === 'team' ? t('stepRolesHint')
              : step === 'safety' ? t('stepSafetyHint')
              : t('setupDoneHint')}
          </p>
        </div>

        {/* ---- body ---- */}
        <div
          key={step}
          className="rise"
          style={{ flex: '1 1 auto', overflowY: 'auto', padding: '10px 20px 20px', maxWidth: 620, width: '100%', margin: '0 auto' }}
        >
          {step === 'days' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                const on = draft.workingDays.includes(d)
                return (
                  <button
                    key={d} type="button" role="switch" aria-checked={on} className="press"
                    onClick={() => patch({
                      workingDays: on
                        ? draft.workingDays.filter((x) => x !== d)
                        : [...draft.workingDays, d].sort(),
                    })}
                    style={rowStyle(on)}
                  >
                    <span style={{ flex: 1, textAlign: 'start' }}>{dayName(d, lang)}</span>
                    <Switch on={on} />
                  </button>
                )
              })}
            </div>
          )}

          {step === 'hours' && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 140px' }}>
                <p className="sh-sub" style={{ margin: '0 0 6px' }}>{t('startTime')}</p>
                <TimeWheel value={draft.openTime} onChange={(v) => patch({ openTime: v })} />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <p className="sh-sub" style={{ margin: '0 0 6px' }}>{t('endTime')}</p>
                <TimeWheel value={draft.closeTime} onChange={(v) => patch({ closeTime: v })} />
              </div>
            </div>
          )}

          {step === 'presets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {draft.presets.map((preset) => (
                <div key={preset.id} className="sh-panel" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: 999, background: preset.color, flex: '0 0 auto',
                    }} aria-hidden />
                    <span className="sh-label" style={{ flex: 1 }}>{tri(preset.name)}</span>
                    <button
                      type="button" className="press"
                      onClick={() => patch({ presets: draft.presets.filter((p) => p.id !== preset.id) })}
                      style={{
                        font: 'inherit', fontSize: '0.76rem', fontWeight: 600, color: '#ff6b6b',
                        background: 'none', border: 'none', cursor: 'pointer',
                      }}
                    >
                      {t('remove')}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 120px' }}>
                      <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('startTime')}</p>
                      <TimeWheel
                        value={preset.start}
                        onChange={(v) => patch({
                          presets: draft.presets.map((p) => (p.id === preset.id ? { ...p, start: v } : p)),
                        })}
                      />
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                      <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('endTime')}</p>
                      <TimeWheel
                        value={preset.end}
                        onChange={(v) => patch({
                          presets: draft.presets.map((p) => (p.id === preset.id ? { ...p, end: v } : p)),
                        })}
                      />
                    </div>
                  </div>
                </div>
              ))}
              {!draft.presets.length && (
                <p className="sh-sub" style={{ margin: 0 }}>
                  {tri({ he: 'אפשר להמשיך בלי תבניות ולבנות כל משמרת ידנית.', en: 'You can continue without presets and build each shift by hand.', ar: 'يمكنك المتابعة بدون قوالب.' })}
                </p>
              )}
            </div>
          )}

          {step === 'team' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
                {/* The catalogue, not the draft — otherwise switching a role
                    off would remove it from the list and there would be no way
                    to switch it back on. Any role the venue invented later is
                    unioned in so a re-run of setup cannot silently drop it. */}
                {[...DEFAULT_ROLES, ...draft.roles.filter((r) => !DEFAULT_ROLES.some((d) => d.id === r.id))].map((role) => {
                  const on = draft.roles.some((r) => r.id === role.id)
                  return (
                    <button
                      key={role.id} type="button" role="switch" aria-checked={on} className="press"
                      onClick={() => patch({
                        roles: on ? draft.roles.filter((r) => r.id !== role.id) : [...draft.roles, role],
                      })}
                      style={rowStyle(on)}
                    >
                      <span aria-hidden>{role.emoji}</span>
                      <span style={{ flex: 1, textAlign: 'start' }}>{tri(role.name)}</span>
                      <Switch on={on} small />
                    </button>
                  )
                })}
              </div>

              <h3 style={{ margin: '0 0 8px', fontSize: '0.9rem', fontWeight: 700 }}>{t('stepStations')}</h3>
              <p className="sh-sub" style={{ margin: '0 0 10px' }}>{t('stepStationsHint')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {draft.stations.map((s) => (
                  <button
                    key={s.id} type="button" className="press"
                    onClick={() => patch({ stations: draft.stations.filter((x) => x.id !== s.id) })}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '7px 12px', borderRadius: 999, font: 'inherit',
                      fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                      border: '1px solid rgba(56,225,255,0.35)', background: 'rgba(56,225,255,0.08)',
                      color: 'var(--text)',
                    }}
                  >
                    {s.emoji} {tri(s.name)}
                    <span aria-hidden style={{ opacity: 0.6 }}>✕</span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newStation} onChange={(e) => setNewStation(e.target.value)}
                  placeholder={tri({ he: 'עמדה חדשה', en: 'New station', ar: 'محطة جديدة' })}
                  maxLength={24}
                  onKeyDown={(e) => { if (e.key === 'Enter') addStation() }}
                  style={inputStyle}
                />
                <button type="button" className="press" onClick={addStation} style={{
                  flex: '0 0 auto', padding: '0 18px', borderRadius: 12, border: '1px solid var(--line-strong)',
                  background: 'var(--bg-elev)', color: 'var(--text)', font: 'inherit',
                  fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer',
                }}>
                  {t('add')}
                </button>
              </div>
            </>
          )}

          {step === 'safety' && (
            <div>
              <NumberSlider
                label={t('maxWeeklyHours')} value={draft.safety.maxWeeklyHours}
                {...SAFETY_BOUNDS.maxWeeklyHours} unit={t('hoursUnit')}
                onChange={(v) => patch({ safety: { ...draft.safety, maxWeeklyHours: v } })}
              />
              <NumberSlider
                label={t('minRestHours')} value={draft.safety.minRestHours}
                {...SAFETY_BOUNDS.minRestHours} unit={t('hoursUnit')}
                onChange={(v) => patch({ safety: { ...draft.safety, minRestHours: v } })}
              />
              <NumberSlider
                label={t('maxDailyHours')} value={draft.safety.maxDailyHours}
                {...SAFETY_BOUNDS.maxDailyHours} unit={t('hoursUnit')}
                onChange={(v) => patch({ safety: { ...draft.safety, maxDailyHours: v } })}
              />
              <NumberSlider
                label={t('maxConsecutive')} value={draft.safety.maxConsecutiveDays}
                {...SAFETY_BOUNDS.maxConsecutiveDays} unit={t('daysUnit')}
                onChange={(v) => patch({ safety: { ...draft.safety, maxConsecutiveDays: v } })}
              />
            </div>
          )}

          {step === 'done' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <p className="sh-sub" style={{ margin: '0 0 6px' }}>{t('stepFeatures')}</p>
              <FeatureRow
                label={t('featureAvailability')} hint={t('featureAvailabilityHint')}
                on={draft.features.ENABLE_AVAILABILITY_SUBMISSIONS}
                onToggle={() => patch({
                  features: {
                    ...draft.features,
                    ENABLE_AVAILABILITY_SUBMISSIONS: !draft.features.ENABLE_AVAILABILITY_SUBMISSIONS,
                  },
                })}
              />
              <FeatureRow
                label={t('featureSwaps')} hint={t('featureSwapsHint')}
                on={draft.features.ENABLE_SHIFT_SWAPS}
                onToggle={() => patch({
                  features: { ...draft.features, ENABLE_SHIFT_SWAPS: !draft.features.ENABLE_SHIFT_SWAPS },
                })}
              />
            </div>
          )}
        </div>

        {/* ---- footer ---- */}
        <div style={{
          flex: '0 0 auto', display: 'flex', gap: 8,
          padding: `12px 20px calc(env(safe-area-inset-bottom) + 16px)`,
          borderTop: '1px solid var(--line)', maxWidth: 620, width: '100%', margin: '0 auto',
        }}>
          {index > 0 && (
            <button
              type="button" className="press" onClick={() => setStep(STEPS[index - 1])}
              style={{
                flex: '0 0 auto', padding: '13px 20px', borderRadius: 14,
                border: '1px solid var(--line)', background: 'transparent',
                color: 'var(--text-dim)', font: 'inherit', fontSize: '0.95rem',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              {t('back')}
            </button>
          )}
          <button
            type="button" className="press" disabled={busy}
            onClick={() => (step === 'done' ? finish() : setStep(STEPS[index + 1]))}
            style={{
              flex: 1, padding: '13px 0', borderRadius: 14, border: 'none',
              background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
              color: '#fff', font: 'inherit', fontSize: '0.98rem', fontWeight: 700,
              cursor: busy ? 'default' : 'pointer', boxShadow: 'var(--glow)',
            }}
          >
            {busy ? t('saving') : step === 'done' ? t('startBuilding') : t('next')}
          </button>
        </div>
      </div>
    </ModalPortal>
  )

  function addStation() {
    const name = newStation.trim()
    if (!name) return
    patch({
      stations: [...draft.stations, {
        id: `station-${Date.now().toString(36)}`,
        name: { he: name, en: name, ar: name },
        emoji: '📍',
      }],
    })
    setNewStation('')
  }
}

function FeatureRow({ label, hint, on, onToggle }: {
  label: string; hint: string; on: boolean; onToggle: () => void
}) {
  return (
    <button type="button" role="switch" aria-checked={on} className="press" onClick={onToggle}
      style={{ ...rowStyle(on), alignItems: 'flex-start' }}>
      <span style={{ flex: 1, textAlign: 'start' }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
        <span className="sh-sub" style={{ display: 'block' }}>{hint}</span>
      </span>
      <Switch on={on} />
    </button>
  )
}

/** A plain deep copy. The draft must not share array references with the live
 *  settings, or editing the wizard would mutate what is on screen behind it. */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const rowStyle = (on: boolean) => ({
  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
  padding: '13px 14px', borderRadius: 14, font: 'inherit', fontSize: '0.92rem',
  cursor: 'pointer', textAlign: 'start' as const,
  border: `1px solid ${on ? 'rgba(255,94,58,0.35)' : 'var(--line)'}`,
  background: on ? 'rgba(255,94,58,0.07)' : 'var(--bg-elev)',
  color: 'var(--text)',
})

const inputStyle = {
  flex: 1, minWidth: 0, padding: '12px 13px', borderRadius: 12,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
  color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
} as const
