// Reading a published week's frozen snapshot into the plain `{ date, start, end,
// assignments }` shape the presence rules use. PURE — no Supabase, no React.
//
// TWO SHAPES EXIST IN THE WILD, and this reads both, because the scheduler was
// rebuilt on 2026-10-12 (PR #6) and its migrations (052–055) are applied on the
// owner's schedule, not on deploy:
//
//   OLD (migration 027, until 052 converts it in place) — nested:
//     { shifts: [ { id, date, start, end, presetId, …,
//                   assignments: [ { id, staffId, staffName, roleId, status } ] } ] }
//
//   NEW (what `sched_publish_week()` writes since 052) — flat, `to_jsonb` of the
//   real rows, snake_case:
//     { shifts:      [ { id, shift_date, start_time, end_time, … } ],
//       assignments: [ { id, shift_id, staff_id, staff_name, role_id, status } ] }
//
// camelCase keys are accepted for each too (the TypeScript serializer does the
// same: `row.shift_date ?? row.date`). The SQL twin of this function is the CTE
// inside `waiter_published_shifts_near()` in migration 057 — one rule spelled
// twice, pinned by scripts/check-presence.mjs on both shapes.

import type { PresenceShift } from './presence'

type Raw = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** `"18:00:00"` → `"18:00"`. */
const hm = (v: unknown): string | null => {
  const s = str(v)
  return s ? s.slice(0, 5) : null
}

export function shiftsFromSnapshot(snapshot: unknown): PresenceShift[] {
  if (!snapshot || typeof snapshot !== 'object') return []
  const snap = snapshot as { shifts?: unknown; assignments?: unknown }
  if (!Array.isArray(snap.shifts)) return []

  // NEW shape: assignments live beside the shifts, keyed by shift id.
  const flat = new Map<string, PresenceShift['assignments']>()
  if (Array.isArray(snap.assignments)) {
    for (const a of snap.assignments as Raw[]) {
      if (!a || typeof a !== 'object') continue
      const shiftId = str(a.shift_id) ?? str(a.shiftId)
      if (!shiftId) continue
      const list = flat.get(shiftId) ?? []
      list.push({
        staffId: str(a.staff_id) ?? str(a.staffId),
        staffName: str(a.staff_name) ?? str(a.staffName) ?? undefined,
        roleId: str(a.role_id) ?? str(a.roleId) ?? undefined,
      })
      flat.set(shiftId, list)
    }
  }

  const out: PresenceShift[] = []
  for (const sh of snap.shifts as Raw[]) {
    if (!sh || typeof sh !== 'object') continue
    const date = str(sh.shift_date) ?? str(sh.date)
    const start = hm(sh.start_time) ?? hm(sh.startTime) ?? hm(sh.start)
    const end = hm(sh.end_time) ?? hm(sh.endTime) ?? hm(sh.end)
    if (!date || !start || !end) continue
    const id = str(sh.id) ?? undefined

    let assignments: PresenceShift['assignments']
    if (id && flat.has(id)) {
      assignments = flat.get(id)
    } else if (Array.isArray(sh.assignments)) {
      // OLD shape: nested under the shift.
      assignments = (sh.assignments as Raw[]).filter((a) => a && typeof a === 'object').map((a) => ({
        staffId: str(a.staffId) ?? str(a.staff_id),
        staffName: str(a.staffName) ?? str(a.staff_name) ?? undefined,
        roleId: str(a.roleId) ?? str(a.role_id) ?? undefined,
      }))
    } else {
      assignments = []
    }
    out.push({ id, date, start, end, assignments })
  }
  return out
}
