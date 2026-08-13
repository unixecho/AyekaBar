// Who can do what with the schedule. Sits on top of lib/staff/access.ts rather
// than beside it — the three existing levels (OP / menu editor / staff) are
// unchanged, and this adds one more capability that borrows OP from them.
//
//   MANAGE SCHEDULE   OP
//                     OR badge = 'general_manager'
//                     OR staff.id listed in settings.scheduleManagers
//
// The third clause is the delegation Johnathan asked for: scheduling is the
// general manager's job UNTIL it is explicitly handed to a shift manager. It is
// a per-person, per-venue grant the manager panel toggles — not a badge rule,
// because "אחראי/ת משמרת" is a job title several people hold and only some of
// them should be drafting the week.
//
// WHY THE GRANT IS NOT A public.staff COLUMN
// public.staff is shared: middleware, both guards, the waiter app's
// is_staff_client() and the staff directory view all read it, and middleware
// selects an explicit column list. Adding a column there means every one of
// those has to learn about scheduling, and a `select('role, badge, …')` that
// runs before the migration lands takes the whole owner panel down. Storing the
// grant in the venue's own settings row keeps the blast radius inside this
// module and makes the grant venue-scoped for free.
//
// MIRRORED IN SQL by `is_schedule_manager(venue)` in migration 027. Change both
// together — `is_op()` and `isOp()` drifting apart is exactly the bug this
// codebase already paid for once.

import { isOp, type AccessRow } from '@/lib/staff/access'
import type { ShiftSettings, Tri } from './types'

/** The staff row plus its schedule identity. `id` is `staff.id`. */
export interface ScheduleAccessRow extends AccessRow {
  id?: string | null
}

/** May open the builder, edit settings, and publish a week. */
export function canManageSchedule(
  row: ScheduleAccessRow | null | undefined,
  settings: Pick<ShiftSettings, 'scheduleManagers'> | null | undefined,
): boolean {
  if (!row) return false
  if (isOp(row)) return true
  if (row.badge === 'general_manager') return true
  return !!row.id && !!settings?.scheduleManagers?.includes(row.id)
}

/** May hand scheduling rights to someone else. Deliberately narrower than
 *  managing: a delegate runs the schedule, they do not widen the circle. */
export function canDelegateSchedule(row: ScheduleAccessRow | null | undefined): boolean {
  if (!row) return false
  return isOp(row) || row.badge === 'general_manager'
}

/** Anyone on the roster may read the PUBLISHED schedule. Drafts are invisible
 *  to them — that separation is enforced by what the data source returns, not
 *  by hiding UI. */
export function canViewSchedule(row: ScheduleAccessRow | null | undefined): boolean {
  return !!row
}

/** Route prefixes this module owns. Middleware imports these so the list lives
 *  in one place, the same way OP_ONLY_PREFIXES already does. */
export const SCHEDULE_MANAGER_PREFIX = '/owner/schedule'
export const SCHEDULE_STAFF_PREFIX = '/staff/schedule'

/** Both surfaces require a staff row at the middleware layer; the precise
 *  manage-vs-view split is re-checked server-side in the page, following the
 *  established "middleware is the first gate, not the only one" rule. */
export const SCHEDULE_PREFIXES = [SCHEDULE_MANAGER_PREFIX, SCHEDULE_STAFF_PREFIX]

export function scheduleAccessLabel(
  row: ScheduleAccessRow,
  settings: Pick<ShiftSettings, 'scheduleManagers'> | null,
): { text: Tri; color: string } {
  if (isOp(row)) return { text: { he: 'ניהול מלא', en: 'Full control', ar: 'تحكم كامل' }, color: '#ff8a5c' }
  if (row.badge === 'general_manager') return { text: { he: 'ניהול סידור', en: 'Schedule manager', ar: 'إدارة الجدول' }, color: '#fb7185' }
  if (canManageSchedule(row, settings)) return { text: { he: 'הרשאת סידור', en: 'Delegated', ar: 'مفوَّض' }, color: '#60a5fa' }
  return { text: { he: 'צפייה', en: 'View only', ar: 'عرض فقط' }, color: '#a8a5b0' }
}
