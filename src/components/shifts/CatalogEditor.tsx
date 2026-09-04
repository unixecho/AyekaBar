'use client'

import { useState } from 'react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import TimeWheel from '@/components/TimeWheel'
import TriField from '@/components/shifts/TriField'
import { haptic } from '@/lib/haptics'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import { ACCENTS } from '@/lib/shifts/config'
import { BADGE_OPTIONS } from '@/lib/staff/badges'
import type {
  RoleRequirement, ShiftPreset, ShiftRole, ShiftSettings, Station,
} from '@/lib/shifts/types'

// Three catalog editors — shift types, roles, stations — sharing one
// interaction model (add / rename via TriField / reorder / delete-with-impact)
// and one contract: `{ settings, onChange }`, never a dispatch of their own.
// That is what makes the SAME components usable both in ManagerPanel (which
// wraps onChange in an immediate settings.update dispatch) and in
// OnboardingFlow (which wraps it in a local draft patch, committed once at
// the end) — the divergence between "set up once" and "edit forever" that
// PLAN_SHIFTS.md Part II section 14 names as the bug being fixed.
//
// DELETE SAFETY (decision D12): deleting a catalog entry never breaks a
// week. Nothing here cascades a delete into shifts/assignments — an
// assignment or shift referencing a since-deleted role/station/preset just
// keeps its (now-orphaned) id, which the rules engine flags
// (`unknown_role`) and the UI renders as a neutral "removed" chip rather
// than crashing or silently vanishing. What this file DOES do is tell the
// manager the impact BEFORE they delete: the confirm sheet counts how many
// shifts/assignments in the currently loaded 3-week window reference the
// thing being removed.

interface CatalogProps {
  settings: ShiftSettings
  onChange: (patch: Partial<ShiftSettings>) => void
}

function reorder<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir
  if (target < 0 || target >= list.length) return list
  const next = list.slice()
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

// A11y (WCAG 2.4.6 / 4.1.2 quality): every glyph button below used to set
// its aria-label to the GLYPH ITSELF ("▲"/"▼"/"−"/"＋", or a raw hex code
// for ColorSwatches) — a valid accessible name in the strict sense (never
// empty), but not a meaningful one; "▲" is not a word in any of this
// app's three languages. Found 2026-09-04 auditing the shift scheduler's
// catalog editor. Real, trilingual-consistent (Hebrew, matching the rest
// of this module) words now, with the reorder buttons also taking the
// item's own name so a screen reader hears "Move Waiter up", not just
// "Move up".
function ReorderButtons({ index, count, onMove, itemLabel }: {
  index: number; count: number; onMove: (dir: -1 | 1) => void
  /** The catalog row's own name, e.g. "מלצר" — folded into the accessible
   *  name so "הזזה למעלה" doesn't repeat identically across every row. */
  itemLabel: string
}) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1 }}>
      <MiniButton glyph="▲" label={`הזזה למעלה — ${itemLabel}`} disabled={index === 0} onClick={() => onMove(-1)} />
      <MiniButton glyph="▼" label={`הזזה למטה — ${itemLabel}`} disabled={index === count - 1} onClick={() => onMove(1)} />
    </span>
  )
}

function MiniButton({ glyph, label, disabled, onClick }: {
  glyph: string; label: string; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label}
      style={{
        width: 20, height: 16, borderRadius: 4, border: 'none',
        background: disabled ? 'transparent' : 'var(--bg-elev-2)',
        color: disabled ? 'var(--text-faint)' : 'var(--text-dim)',
        font: 'inherit', fontSize: '0.55rem', lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  )
}

function Stepper({ value, onChange, disabled, itemLabel }: {
  value: number; onChange: (delta: number) => void; disabled?: boolean
  /** Folded into the +/- buttons' names, same reasoning as ReorderButtons
   *  above — "Decrease" alone doesn't say decrease WHAT once there's more
   *  than one of these on a page. */
  itemLabel?: string
}) {
  const suffix = itemLabel ? ` — ${itemLabel}` : ''
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, direction: 'ltr',
      border: '1px solid var(--line-strong)', borderRadius: 999, padding: 2, flex: '0 0 auto',
    }}>
      <StepButton glyph="−" label={`הפחתה${suffix}`} onClick={() => { haptic('tick'); onChange(-1) }} disabled={disabled || value === 0} />
      <span style={{ minWidth: 18, textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
      <StepButton glyph="＋" label={`הוספה${suffix}`} onClick={() => { haptic('tick'); onChange(1) }} disabled={disabled} />
    </span>
  )
}

function StepButton({ glyph, label, onClick, disabled }: {
  glyph: string; label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} aria-label={label}
      style={{
        width: 22, height: 22, borderRadius: 999, border: 'none',
        background: disabled ? 'transparent' : 'var(--bg-elev-2)',
        color: disabled ? 'var(--text-faint)' : 'var(--text)',
        font: 'inherit', fontSize: '0.82rem', fontWeight: 700, cursor: disabled ? 'default' : 'pointer', lineHeight: 1,
      }}
    ><span aria-hidden>{glyph}</span></button>
  )
}

// A11y: names for ACCENTS (config.ts) — was aria-label={c}, the raw hex
// string itself, which is not a word a screen reader can usefully say.
// Real names, in the same order ACCENTS lists them.
const ACCENT_NAME: Record<string, string> = {
  '#ff5e3a': 'כתום', '#ff8a5c': 'אפרסק', '#fb7185': 'ורוד אלמוג',
  '#f472b6': 'פוקסיה', '#c084fc': 'סגול', '#60a5fa': 'כחול',
  '#38e1ff': 'תכלת', '#2dd4bf': 'טורקיז', '#4ade80': 'ירוק', '#fbbf24': 'צהוב',
}

function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ACCENTS.map((c) => (
        <button
          key={c} type="button" onClick={() => onChange(c)} aria-label={ACCENT_NAME[c] ?? c}
          aria-pressed={c === value}
          style={{
            width: 22, height: 22, borderRadius: 999, background: c, cursor: 'pointer',
            border: c === value ? '2px solid var(--text)' : '2px solid transparent',
            boxShadow: c === value ? '0 0 0 2px var(--bg-elev)' : 'none',
          }}
        />
      ))}
    </div>
  )
}

function EmojiInput({ value, onChange, itemLabel }: {
  value: string; onChange: (v: string) => void
  /** The catalog row's own name — folds into "סמל — מלצר" so a screen
   *  reader hears which row's icon this is, not just "Symbol" repeated
   *  identically on every row. */
  itemLabel: string
}) {
  return (
    <input
      value={value} maxLength={4}
      aria-label={`סמל — ${itemLabel}`}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 44, padding: '7px 0', borderRadius: 10, textAlign: 'center',
        border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
        color: 'var(--text)', fontSize: '1.05rem', fontFamily: 'inherit', outline: 'none',
      }}
    />
  )
}

function ghostButton(danger = false): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 8, border: '1px solid var(--line-strong)',
    background: 'transparent', color: danger ? '#ff6b6b' : 'var(--text-dim)',
    fontSize: '0.74rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  }
}

const addButtonStyle: React.CSSProperties = {
  width: '100%', padding: '10px 0', borderRadius: 12, marginTop: 6,
  border: '1px dashed var(--line-strong)', background: 'transparent',
  color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
}

const cardStyle: React.CSSProperties = {
  padding: 12, borderRadius: 13, border: '1px solid var(--line)',
  background: 'var(--bg-elev-2)', display: 'flex', flexDirection: 'column', gap: 10,
}

// ── Shift types (presets) ────────────────────────────────────────────────

export function PresetCatalog({ settings, onChange }: CatalogProps) {
  const { t, tri, db } = useShifts()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const presets = settings.presets

  const update = (id: string, patch: Partial<ShiftPreset>) =>
    onChange({ presets: presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  const add = () => {
    const id = `preset-${Date.now().toString(36)}`
    onChange({
      presets: [...presets, {
        id, name: { he: t('newPreset'), en: '', ar: '' }, start: '18:00', end: '22:00',
        color: ACCENTS[presets.length % ACCENTS.length], requirements: [], stationId: null,
      }],
    })
  }

  const askRemove = (preset: ShiftPreset) => {
    const impact = db.shifts.filter((s) => s.presetId === preset.id).length
    setConfirm({
      title: `${t('remove')} ${tri(preset.name)}`,
      body: impact
        ? t('deletePresetImpact').replace('{n}', String(impact))
        : t('deleteNoImpact'),
      confirmLabel: t('remove'),
      onConfirm: () => onChange({ presets: presets.filter((p) => p.id !== preset.id) }),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {presets.map((preset, i) => (
        <div key={preset.id} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <ReorderButtons index={i} count={presets.length} itemLabel={tri(preset.name)} onMove={(dir) => onChange({ presets: reorder(presets, i, dir) })} />
            <div style={{ flex: 1 }}>
              <TriField value={preset.name} onCommit={(name) => update(preset.id, { name })} />
            </div>
            <button type="button" className="press" onClick={() => askRemove(preset)} style={ghostButton(true)}>
              {t('remove')}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 110px' }}>
              <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('startTime')}</p>
              <TimeWheel value={preset.start} onChange={(v) => update(preset.id, { start: v })} />
            </div>
            <div style={{ flex: '1 1 110px' }}>
              <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('endTime')}</p>
              <TimeWheel value={preset.end} onChange={(v) => update(preset.id, { end: v })} />
            </div>
            <div>
              <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('color')}</p>
              <ColorSwatches value={preset.color} onChange={(color) => update(preset.id, { color })} />
            </div>
          </div>

          <div>
            <p className="sh-sub" style={{ margin: '0 0 2px' }}>{t('defaultStation')}</p>
            {/* The field answered "what is this for?" with nothing at all,
                which is how it read as a staffing control it is not. */}
            <p className="sh-sub" style={{ margin: '0 0 6px', color: 'var(--text-faint)' }}>
              {t('defaultStationHint')}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Pill
                active={!preset.stationId} label={t('noStation')}
                onClick={() => update(preset.id, { stationId: null })}
              />
              {settings.stations.map((s) => (
                <Pill
                  key={s.id} active={preset.stationId === s.id} label={`${s.emoji} ${tri(s.name)}`}
                  onClick={() => update(preset.id, { stationId: s.id })}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="sh-sub" style={{ margin: '0 0 6px' }}>{t('staffingNeeded')}</p>
            <RequirementsEditor
              requirements={preset.requirements} roles={settings.roles}
              onChange={(requirements) => update(preset.id, { requirements })}
            />
          </div>
        </div>
      ))}

      <button type="button" className="press" onClick={add} style={addButtonStyle}>
        ＋ {t('addPreset')}
      </button>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

function RequirementsEditor({ requirements, roles, onChange }: {
  requirements: RoleRequirement[]; roles: ShiftRole[]
  onChange: (next: RoleRequirement[]) => void
}) {
  const { t, tri } = useShifts()
  if (!roles.length) return <p className="sh-sub" style={{ margin: 0 }}>{t('noRolesYet')}</p>

  const setMin = (roleId: string, delta: number) => {
    const existing = requirements.find((r) => r.roleId === roleId)
    const nextMin = Math.max(0, (existing?.min ?? 0) + delta)
    if (nextMin === 0) onChange(requirements.filter((r) => r.roleId !== roleId))
    else if (existing) onChange(requirements.map((r) => (r.roleId === roleId ? { ...r, min: nextMin } : r)))
    else onChange([...requirements, { roleId, min: nextMin }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {roles.map((role) => {
        const req = requirements.find((r) => r.roleId === role.id)
        return (
          <div key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden>{role.emoji}</span>
            <span style={{ flex: 1, fontSize: '0.8rem', color: 'var(--text-dim)' }}>{tri(role.name)}</span>
            <Stepper value={req?.min ?? 0} onChange={(d) => setMin(role.id, d)} itemLabel={tri(role.name)} />
          </div>
        )
      })}
    </div>
  )
}

function Pill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button" className="press" onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 999, font: 'inherit', fontSize: '0.78rem', fontWeight: 600,
        cursor: 'pointer', border: `1px solid ${active ? 'rgba(56,225,255,0.4)' : 'var(--line)'}`,
        background: active ? 'rgba(56,225,255,0.1)' : 'var(--bg-elev)',
        color: active ? 'var(--text)' : 'var(--text-dim)',
      }}
    >
      {label}
    </button>
  )
}

// ── Roles ──────────────────────────────────────────────────────────────

export function RoleCatalog({ settings, onChange }: CatalogProps) {
  const { t, tri, db } = useShifts()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const roles = settings.roles

  const update = (id: string, patch: Partial<ShiftRole>) =>
    onChange({ roles: roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) })

  const add = () => {
    const id = `role-${Date.now().toString(36)}`
    onChange({ roles: [...roles, { id, name: { he: t('newRole'), en: '', ar: '' }, emoji: '👤', color: ACCENTS[roles.length % ACCENTS.length] }] })
  }

  const askRemove = (role: ShiftRole) => {
    const assignmentImpact = db.assignments.filter((a) => a.roleId === role.id).length
    const requirementImpact = settings.presets.filter((p) => p.requirements.some((r) => r.roleId === role.id)).length
    const impact = assignmentImpact + requirementImpact
    setConfirm({
      title: `${t('remove')} ${tri(role.name)}`,
      body: impact ? t('deleteRoleImpact').replace('{n}', String(impact)) : t('deleteNoImpact'),
      confirmLabel: t('remove'),
      onConfirm: () => onChange({ roles: roles.filter((r) => r.id !== role.id) }),
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {roles.map((role, i) => (
        <div key={role.id} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <ReorderButtons index={i} count={roles.length} itemLabel={tri(role.name)} onMove={(dir) => onChange({ roles: reorder(roles, i, dir) })} />
            <EmojiInput value={role.emoji} onChange={(emoji) => update(role.id, { emoji })} itemLabel={tri(role.name)} />
            <div style={{ flex: 1 }}>
              <TriField value={role.name} onCommit={(name) => update(role.id, { name })} />
            </div>
            <button type="button" className="press" onClick={() => askRemove(role)} style={ghostButton(true)}>
              {t('remove')}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <ColorSwatches value={role.color} onChange={(color) => update(role.id, { color })} />
          </div>

          <div>
            <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('linkedBadge')}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Pill active={!role.badge} label={t('noBadgeLink')} onClick={() => update(role.id, { badge: undefined })} />
              {BADGE_OPTIONS.filter((b) => b.key !== 'owner').map((b) => (
                <Pill
                  key={b.key} active={role.badge === b.key} label={`${b.emoji} ${b.he}`}
                  onClick={() => update(role.id, { badge: b.key as ShiftRole['badge'] })}
                />
              ))}
            </div>
          </div>
        </div>
      ))}

      <button type="button" className="press" onClick={add} style={addButtonStyle}>
        ＋ {t('addRole')}
      </button>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}

// ── Stations ───────────────────────────────────────────────────────────

export function StationCatalog({ settings, onChange }: CatalogProps) {
  const { t, tri, db } = useShifts()
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const stations = settings.stations

  const update = (id: string, patch: Partial<Station>) =>
    onChange({ stations: stations.map((s) => (s.id === id ? { ...s, ...patch } : s)) })

  const add = () => {
    const id = `station-${Date.now().toString(36)}`
    onChange({ stations: [...stations, { id, name: { he: t('newStation'), en: '', ar: '' }, emoji: '📍' }] })
  }

  const askRemove = (station: Station) => {
    const shiftImpact = db.shifts.filter((s) => s.stationId === station.id).length
    const presetImpact = settings.presets.filter((p) => p.stationId === station.id).length
    const impact = shiftImpact + presetImpact
    setConfirm({
      title: `${t('remove')} ${tri(station.name)}`,
      body: impact ? t('deleteStationImpact').replace('{n}', String(impact)) : t('deleteNoImpact'),
      confirmLabel: t('remove'),
      onConfirm: () => onChange({ stations: stations.filter((s) => s.id !== station.id) }),
    })
  }

  const toggleRole = (station: Station, roleId: string) => {
    const current = station.roleIds ?? []
    const next = current.includes(roleId) ? current.filter((r) => r !== roleId) : [...current, roleId]
    update(station.id, { roleIds: next.length ? next : undefined })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {stations.map((station, i) => (
        <div key={station.id} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <ReorderButtons index={i} count={stations.length} itemLabel={tri(station.name)} onMove={(dir) => onChange({ stations: reorder(stations, i, dir) })} />
            <EmojiInput value={station.emoji} onChange={(emoji) => update(station.id, { emoji })} itemLabel={tri(station.name)} />
            <div style={{ flex: 1 }}>
              <TriField value={station.name} onCommit={(name) => update(station.id, { name })} />
            </div>
            <button type="button" className="press" onClick={() => askRemove(station)} style={ghostButton(true)}>
              {t('remove')}
            </button>
          </div>

          {!!settings.roles.length && (
            <div>
              <p className="sh-sub" style={{ margin: '0 0 4px' }}>{t('restrictToRoles')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {settings.roles.map((role) => (
                  <Pill
                    key={role.id} active={(station.roleIds ?? []).includes(role.id)}
                    label={`${role.emoji} ${tri(role.name)}`}
                    onClick={() => toggleRole(station, role.id)}
                  />
                ))}
              </div>
              {!station.roleIds?.length && (
                <p className="sh-sub" style={{ margin: '4px 0 0' }}>{t('noRoleRestriction')}</p>
              )}
            </div>
          )}
        </div>
      ))}

      <button type="button" className="press" onClick={add} style={addButtonStyle}>
        ＋ {t('addStation')}
      </button>

      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </div>
  )
}
