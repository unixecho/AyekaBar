'use client'

import { useState } from 'react'
import Switch from '@/components/Switch'
import TimeWheel from '@/components/TimeWheel'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import { PresetCatalog, RoleCatalog, StationCatalog } from '@/components/shifts/CatalogEditor'
import NumberSlider from '@/components/shifts/NumberSlider'
import RosterPanel from '@/components/shifts/RosterPanel'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { SAFETY_BOUNDS } from '@/lib/shifts/config'
import { WARNING_LABELS } from '@/lib/shifts/i18n'
import { dayName } from '@/lib/shifts/time'
import type { SafetyRules } from '@/lib/shifts/types'

// Everything the onboarding asked, permanently editable — which is the point:
// a bar's hours change with the season, and a setup answer that can only be
// given once becomes a lie within a month.
//
// Writes go straight through on change. There is no Save button because there
// is nothing to lose by a half-finished edit: each control is independently
// meaningful, and each change is its own audit line.

export default function ManagerPanel({ onRerunSetup }: { onRerunSetup: () => void }) {
  const { db, t, tri, lang, dispatch, isMock, resetDemo } = useShifts()
  const { settings } = db
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const setSafety = (patch: Partial<SafetyRules>) =>
    dispatch({ type: 'settings.update', patch: { safety: { ...settings.safety, ...patch } } })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ---- working days ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepDays')} hint={t('stepDaysHint')} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const on = settings.workingDays.includes(d)
            return (
              <button
                key={d} type="button" role="switch" aria-checked={on} className="press"
                onClick={() => dispatch({
                  type: 'settings.update',
                  patch: {
                    workingDays: on
                      ? settings.workingDays.filter((x) => x !== d)
                      : [...settings.workingDays, d].sort(),
                  },
                })}
                style={{
                  padding: '8px 14px', borderRadius: 999, font: 'inherit',
                  fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                  border: `1px solid ${on ? 'rgba(255,94,58,0.4)' : 'var(--line)'}`,
                  background: on ? 'rgba(255,94,58,0.1)' : 'var(--bg-elev-2)',
                  color: on ? 'var(--text)' : 'var(--text-faint)',
                }}
              >
                {dayName(d, lang)}
              </button>
            )
          })}
        </div>
      </section>

      {/* ---- operating hours ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepHours')} hint={t('stepHoursHint')} />
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 130px' }}>
            <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('startTime')}</p>
            <TimeWheel
              value={settings.openTime}
              onChange={(v) => dispatch({ type: 'settings.update', patch: { openTime: v } })}
            />
          </div>
          <div style={{ flex: '1 1 130px' }}>
            <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('endTime')}</p>
            <TimeWheel
              value={settings.closeTime}
              onChange={(v) => dispatch({ type: 'settings.update', patch: { closeTime: v } })}
            />
          </div>
        </div>
      </section>

      {/* ---- per-day hour overrides ---- */}
      <section className="sh-panel">
        <SectionHead title={t('dayHoursTitle')} hint={t('dayHoursHint')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const override = settings.dayHours[d]
            const on = !!override
            return (
              <div key={d} style={{
                padding: '10px 12px', borderRadius: 13,
                border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
              }}>
                <button
                  type="button" role="switch" aria-checked={on} className="press"
                  onClick={() => {
                    const next = { ...settings.dayHours }
                    if (on) delete next[d]
                    else next[d] = { open: settings.openTime, close: settings.closeTime }
                    dispatch({ type: 'settings.update', patch: { dayHours: next } })
                  }}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', font: 'inherit',
                  }}
                >
                  <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{dayName(d, lang)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>
                      {on ? t('dayHoursCustom') : (
                        <>{t('dayHoursDefault')} <span style={{ direction: 'ltr', display: 'inline-block' }}>{settings.openTime}–{settings.closeTime}</span></>
                      )}
                    </span>
                    <Switch on={on} small />
                  </span>
                </button>

                {on && (
                  <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                    <div style={{ flex: '1 1 120px' }}>
                      <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('startTime')}</p>
                      <TimeWheel
                        value={override.open}
                        onChange={(v) => dispatch({
                          type: 'settings.update',
                          patch: { dayHours: { ...settings.dayHours, [d]: { ...override, open: v } } },
                        })}
                      />
                    </div>
                    <div style={{ flex: '1 1 120px' }}>
                      <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('endTime')}</p>
                      <TimeWheel
                        value={override.close}
                        onChange={(v) => dispatch({
                          type: 'settings.update',
                          patch: { dayHours: { ...settings.dayHours, [d]: { ...override, close: v } } },
                        })}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ---- shift types ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepPresets')} hint={t('stepPresetsHint')} />
        <PresetCatalog settings={settings} onChange={(patch) => dispatch({ type: 'settings.update', patch })} />
      </section>

      {/* ---- roles ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepRoles')} hint={t('stepRolesHint')} />
        <RoleCatalog settings={settings} onChange={(patch) => dispatch({ type: 'settings.update', patch })} />
      </section>

      {/* ---- stations ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepStations')} hint={t('stepStationsHint')} />
        <StationCatalog settings={settings} onChange={(patch) => dispatch({ type: 'settings.update', patch })} />
      </section>

      {/* ---- safety ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepSafety')} hint={t('stepSafetyHint')} />
        <NumberSlider
          label={t('maxWeeklyHours')} value={settings.safety.maxWeeklyHours}
          {...SAFETY_BOUNDS.maxWeeklyHours} unit={t('hoursUnit')}
          onChange={(v) => setSafety({ maxWeeklyHours: v })}
        />
        <NumberSlider
          label={t('minRestHours')} value={settings.safety.minRestHours}
          {...SAFETY_BOUNDS.minRestHours} unit={t('hoursUnit')}
          onChange={(v) => setSafety({ minRestHours: v })}
        />
        <NumberSlider
          label={t('maxDailyHours')} value={settings.safety.maxDailyHours}
          {...SAFETY_BOUNDS.maxDailyHours} unit={t('hoursUnit')}
          onChange={(v) => setSafety({ maxDailyHours: v })}
        />
        <NumberSlider
          label={t('maxConsecutive')} value={settings.safety.maxConsecutiveDays}
          {...SAFETY_BOUNDS.maxConsecutiveDays} unit={t('daysUnit')}
          onChange={(v) => setSafety({ maxConsecutiveDays: v })}
        />
      </section>

      {/* ---- warning sensitivity (decision D11) ---- */}
      <section className="sh-panel">
        <SectionHead title={t('warningSensitivity')} hint={t('warningSensitivityHint')} />
        {Object.entries(WARNING_LABELS).map(([code, label]) => {
          const silenced = settings.ruleSeverity?.[code] === 'off'
          return (
            <button
              key={code} type="button" role="switch" aria-checked={!silenced} className="press"
              onClick={() => dispatch({
                type: 'settings.update',
                patch: {
                  ruleSeverity: { ...settings.ruleSeverity, [code]: silenced ? undefined : 'off' },
                },
              })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 2px', borderBottom: '1px solid var(--line)',
                background: 'none', border: 'none', font: 'inherit',
                cursor: 'pointer', textAlign: 'start', color: 'var(--text)',
              }}
            >
              <span style={{ flex: 1, fontSize: '0.85rem' }}>{tri(label)}</span>
              <Switch on={!silenced} small />
            </button>
          )
        })}
      </section>

      {/* ---- feature flags ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepFeatures')} />
        <ToggleRow
          label={t('featureAvailability')} hint={t('featureAvailabilityHint')}
          on={settings.features.ENABLE_AVAILABILITY_SUBMISSIONS}
          onToggle={() => dispatch({
            type: 'settings.update',
            patch: {
              features: {
                ...settings.features,
                ENABLE_AVAILABILITY_SUBMISSIONS: !settings.features.ENABLE_AVAILABILITY_SUBMISSIONS,
              },
            },
          })}
        />
        <ToggleRow
          label={t('featureSwaps')} hint={t('featureSwapsHint')}
          on={settings.features.ENABLE_SHIFT_SWAPS}
          onToggle={() => dispatch({
            type: 'settings.update',
            patch: {
              features: { ...settings.features, ENABLE_SHIFT_SWAPS: !settings.features.ENABLE_SHIFT_SWAPS },
            },
          })}
        />
      </section>

      {/* ---- roster: who's schedulable, and who runs the schedule ---- */}
      <RosterPanel />

      {/* ---- maintenance ---- */}
      <section className="sh-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" className="press" onClick={onRerunSetup} style={ghostButton}>
          {t('rerunSetup')}
        </button>
        {isMock && (
          <button
            type="button" className="press"
            onClick={() => setConfirm({
              title: t('resetDemo'),
              body: t('resetDemoBody'),
              confirmLabel: t('resetDemo'),
              onConfirm: () => { void resetDemo() },
            })}
            style={{ ...ghostButton, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)' }}
          >
            {t('resetDemo')}
          </button>
        )}
      </section>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
      {hint && <p className="sh-sub" style={{ margin: '3px 0 0' }}>{hint}</p>}
    </div>
  )
}

function ToggleRow({ label, hint, on, onToggle }: {
  label: string; hint: string; on: boolean; onToggle: () => void
}) {
  return (
    <button
      type="button" role="switch" aria-checked={on} className="press" onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%',
        padding: '12px 2px', borderBottom: '1px solid var(--line)',
        background: 'none', border: 'none', font: 'inherit',
        cursor: 'pointer', textAlign: 'start', color: 'var(--text)',
      }}
    >
      <span style={{ flex: 1 }}>
        <span className="sh-label" style={{ display: 'block' }}>{label}</span>
        <span className="sh-sub" style={{ display: 'block' }}>{hint}</span>
      </span>
      <Switch on={on} />
    </button>
  )
}

const ghostButton = {
  width: '100%', padding: '12px 0', borderRadius: 13,
  border: '1px solid var(--line-strong)', background: 'transparent',
  color: 'var(--text-dim)', fontSize: '0.88rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
} as const
