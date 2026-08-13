'use client'

import { useState } from 'react'
import Switch from '@/components/Switch'
import TimeWheel from '@/components/TimeWheel'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import NumberSlider from '@/components/shifts/NumberSlider'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { SAFETY_BOUNDS } from '@/lib/shifts/config'
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
  const { db, t, tri, lang, dispatch, viewer, isMock, resetDemo } = useShifts()
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

      {/* ---- presets ---- */}
      <section className="sh-panel">
        <SectionHead title={t('stepPresets')} hint={t('stepPresetsHint')} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {settings.presets.map((p) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
            }}>
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: p.color, flex: '0 0 auto' }} />
              <span className="sh-label" style={{ flex: 1 }}>{tri(p.name)}</span>
              <span className="sh-time" style={{ color: 'var(--text-dim)' }}>{p.start}–{p.end}</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                {p.requirements.reduce((n, r) => n + r.min, 0)} 👤
              </span>
            </div>
          ))}
          <p className="sh-sub" style={{ margin: 0 }}>
            {tri({
              he: 'לשינוי שעות התבנית — דרך ההקמה מחדש, למטה.',
              en: 'To change preset times, re-run setup below.',
              ar: 'لتغيير أوقات القوالب، أعد الإعداد أدناه.',
            })}
          </p>
        </div>
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

      {/* ---- delegation ---- */}
      {viewer.canDelegate && (
        <section className="sh-panel">
          <SectionHead title={t('delegation')} hint={t('delegationHint')} />
          {db.staff.filter((s) => s.active).map((person) => {
            // OP and the general manager hold it by role; the switch is shown
            // on but locked, so the list answers "who can do this?" completely
            // rather than only listing the exceptions.
            const byRole = person.badge === 'owner' || person.badge === 'general_manager' || person.role === 'owner'
            const granted = settings.scheduleManagers.includes(person.id)
            return (
              <button
                key={person.id} type="button" role="switch"
                aria-checked={byRole || granted} disabled={byRole} className={byRole ? undefined : 'press'}
                onClick={() => !byRole && dispatch({
                  type: 'settings.update',
                  patch: {
                    scheduleManagers: granted
                      ? settings.scheduleManagers.filter((id) => id !== person.id)
                      : [...settings.scheduleManagers, person.id],
                  },
                })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '11px 2px', borderBottom: '1px solid var(--line)',
                  background: 'none', border: 'none', borderRadius: 0,
                  font: 'inherit', cursor: byRole ? 'default' : 'pointer', textAlign: 'start',
                  color: 'var(--text)', opacity: byRole ? 0.75 : 1,
                }}
              >
                <span className="sh-dot" style={{ background: person.colour ?? 'var(--line-strong)' }} aria-hidden>
                  {person.initial ?? person.name[0]}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 600 }}>{person.name}</span>
                  {byRole && <span className="sh-sub" style={{ display: 'block' }}>{t('byRole')}</span>}
                </span>
                <Switch on={byRole || granted} small />
              </button>
            )
          })}
        </section>
      )}

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
