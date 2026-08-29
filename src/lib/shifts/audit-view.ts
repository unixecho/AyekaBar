// Turns an `AuditEntry.diff` into rows a bar owner can read.
//
// The diff is stored as raw JSON on purpose — it is a record, and a record
// that has been prettified at write time can no longer answer a question
// nobody thought to ask. But SHOWING that JSON was never intentional: the log
// tab rendered `JSON.stringify(diff, null, 2)` because that was the honest
// placeholder until something better existed. This is that something.
//
// It has to cope with two writers that do not agree on shape, and never will:
//
//   the reducer (store.ts)   camelCase, domain objects — `{ before: {...},
//                            after: {...} }`, or the whole row for a create.
//   Postgres (migration 027) snake_case, whole table rows — `member.update`
//                            hands over every column of schedule_members,
//                            changed or not.
//
// So: walk both sides together, drop the keys that are plumbing rather than
// meaning, skip anything that did not actually change, and resolve ids to the
// names the manager knows those things by. Whatever is left unrecognised falls
// through to a readable rendering of its own value rather than being hidden —
// a log that quietly omits what it doesn't understand is worse than one that
// shows JSON.

import { AUDIT_FIELD_LABELS, AUDIT_VALUE_LABELS, t as translate } from './i18n'
import { dayName } from './time'
import type { AuditEntry, Lang, RoleRequirement, Tri } from './types'

export interface DiffRow {
  label: string
  /** Absent when there was no previous value (a create). */
  before?: string
  /** Absent when the value is gone (a delete). */
  after?: string
}

/** Everything the renderer needs to turn ids into names, injected rather than
 *  imported so this file stays pure and testable. */
export interface AuditLookup {
  lang: Lang
  tri: (value: Tri) => string
  staffName: (id: string) => string | null
  roleName: (id: string) => string | null
  stationName: (id: string) => string | null
  presetName: (id: string) => string | null
}

/** Row plumbing: true of a key, its value never tells anyone anything. */
const NOISE = new Set([
  'id', 'venueId', 'venue_id', 'weekId', 'week_id', 'shiftId', 'shift_id',
  'assignmentId', 'assignment_id', 'swapId', 'swap_id', 'warningId',
  'createdAt', 'created_at', 'updatedAt', 'updated_at',
  'createdBy', 'created_by', 'updatedBy', 'updated_by',
  'publishedBy', 'published_by', 'decidedBy', 'decided_by',
  'actorId', 'actor_id',
])

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^(\d{2}):(\d{2})(:\d{2})?$/

function labelFor(key: string, look: AuditLookup): string {
  const known = AUDIT_FIELD_LABELS[key]
  if (known) return look.tri(known)
  // An unrecognised column still gets a label rather than nothing:
  // `max_weekly_hours` → `max weekly hours`.
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

function fmtRequirements(value: unknown, look: AuditLookup): string {
  if (!Array.isArray(value)) return String(value)
  if (!value.length) return translate('auditEmptyValue', look.lang)
  return (value as RoleRequirement[])
    .map((r) => `${look.roleName(r.roleId) ?? r.roleId} ×${r.min}`)
    .join(', ')
}

function fmtScalar(key: string, value: unknown, look: AuditLookup): string {
  if (value === null || value === undefined || value === '') {
    return translate('auditEmptyValue', look.lang)
  }
  if (typeof value === 'boolean') {
    return translate(value ? 'yes' : 'no', look.lang)
  }
  if (typeof value === 'string') {
    // A clock column comes back from Postgres as `18:00:00`; nobody writes a
    // shift time with seconds.
    const clock = CLOCK.exec(value)
    if (clock) return `${clock[1]}:${clock[2]}`

    if (key.endsWith('StaffId') || key.endsWith('staffId') || key.endsWith('staff_id')) {
      return look.staffName(value) ?? value
    }
    if (key === 'roleId' || key === 'role_id' || key === 'defaultRoleId' || key === 'default_role_id') {
      return look.roleName(value) ?? value
    }
    if (key === 'stationId' || key === 'station_id') return look.stationName(value) ?? value
    if (key === 'presetId' || key === 'preset_id') return look.presetName(value) ?? value

    // A bare enum value — `assigned`, `peer_accepted`, `hourly`. Only consulted
    // for the columns that hold one, so a note reading "open" stays "open".
    if (key === 'status' || key === 'employmentType' || key === 'employment_type') {
      const known = AUDIT_VALUE_LABELS[value]
      if (known) return look.tri(known)
    }
  }
  return String(value)
}

function fmtValue(key: string, value: unknown, look: AuditLookup): string {
  if (key === 'requirements') return fmtRequirements(value, look)

  if (key === 'workingDays' || key === 'working_days') {
    if (!Array.isArray(value)) return String(value)
    if (!value.length) return translate('auditEmptyValue', look.lang)
    return value.map((d) => dayName(Number(d), look.lang)).join(', ')
  }

  if (key === 'scheduleManagers' || key === 'schedule_managers') {
    if (!Array.isArray(value)) return String(value)
    if (!value.length) return translate('auditEmptyValue', look.lang)
    return value.map((id) => look.staffName(String(id)) ?? String(id)).join(', ')
  }

  if (Array.isArray(value)) {
    if (!value.length) return translate('auditEmptyValue', look.lang)
    // A catalog (presets/roles/stations) is a list of named things — name them
    // rather than printing the objects.
    const named = value
      .map((item) => (isPlainObject(item) && isPlainObject(item.name)
        ? look.tri(item.name as unknown as Tri)
        : null))
      .filter((n): n is string => !!n)
    if (named.length === value.length) return named.join(', ')
    return `${value.length}`
  }

  if (isPlainObject(value)) {
    // `dayHours` and friends: a small map of small things. One level, joined.
    const parts = Object.entries(value)
      .slice(0, 6)
      .map(([k, v]) => {
        const inner = isPlainObject(v)
          ? Object.values(v).map((x) => fmtScalar(k, x, look)).join('–')
          : fmtScalar(k, v, look)
        const dayLabel = /^[0-6]$/.test(k) ? dayName(Number(k), look.lang) : labelFor(k, look)
        return `${dayLabel} ${inner}`
      })
    if (!parts.length) return translate('auditEmptyValue', look.lang)
    return parts.join(' · ')
  }

  if (typeof value === 'string' && ISO_DATE.test(value)) return value

  return fmtScalar(key, value, look)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** One key of a before/after pair. Recurses one level into nested settings
 *  objects (`safety`, `features`) so "minimum rest 8 → 10" reads as that
 *  rather than as two dumped objects. */
function walk(
  key: string, before: unknown, after: unknown, look: AuditLookup, out: DiffRow[], depth: number,
): void {
  if (NOISE.has(key)) return
  if (before !== undefined && after !== undefined && same(before, after)) return

  const nested = depth < 1
    && isPlainObject(before) && isPlainObject(after)
    // A catalog map or a day-hours map is a VALUE, not a namespace — recursing
    // into it would emit a row per weekday for one edit.
    && key !== 'dayHours' && key !== 'day_hours'
  if (nested) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    for (const inner of keys) walk(inner, before[inner], after[inner], look, out, depth + 1)
    return
  }

  out.push({
    label: labelFor(key, look),
    ...(before === undefined ? {} : { before: fmtValue(key, before, look) }),
    ...(after === undefined ? {} : { after: fmtValue(key, after, look) }),
  })
}

/**
 * The rows to render under one log entry. Empty when the diff carried nothing
 * beyond plumbing — the caller shows nothing rather than an empty box.
 */
export function auditRows(entry: AuditEntry, look: AuditLookup): DiffRow[] {
  const diff = entry.diff ?? {}
  const rows: DiffRow[] = []

  const before = diff.before
  const after = diff.after
  const hasPair = before !== undefined || after !== undefined

  if (hasPair && (isPlainObject(before) || isPlainObject(after))) {
    const keys = Array.from(new Set([
      ...(isPlainObject(before) ? Object.keys(before) : []),
      ...(isPlainObject(after) ? Object.keys(after) : []),
    ]))
    for (const key of keys) {
      walk(
        key,
        isPlainObject(before) ? before[key] : undefined,
        isPlainObject(after) ? after[key] : undefined,
        look, rows, 0,
      )
    }
  } else if (hasPair) {
    // A scalar before/after — `note.day` is the only one today. The key that
    // names it lives on the action, not in the diff.
    const label = entry.action === 'note.update'
      ? look.tri(AUDIT_FIELD_LABELS.note)
      : look.tri(AUDIT_FIELD_LABELS.value)
    if (!same(before, after)) {
      rows.push({
        label,
        ...(before === undefined ? {} : { before: fmtScalar('note', before, look) }),
        ...(after === undefined ? {} : { after: fmtScalar('note', after, look) }),
      })
    }
  }

  // Everything the diff carries alongside before/after — weekStart, version,
  // counts, the staff member a member.update was about.
  for (const [key, value] of Object.entries(diff)) {
    if (key === 'before' || key === 'after' || NOISE.has(key)) continue
    rows.push({ label: labelFor(key, look), after: fmtValue(key, value, look) })
  }

  return rows
}
