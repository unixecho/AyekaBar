// Authorization predicates for shift scheduling — the TS twin of the SQL functions
// sched_can_manage / sched_can_view / sched_is_op (migration 052). Every predicate
// here MUST stay in sync with its SQL counterpart, same discipline
// lib/staff/access.ts documents for is_op() / is_menu_editor().
//
//   view      any active staff row — the team reads the published schedule
//   manage    OP, or badge = 'general_manager', or someone the owner / GM
//             delegated via shift_settings.schedule_managers[]
//   delegate  deliberately narrower than manage: OP / general manager only, so a
//             delegate can run the schedule but not widen who else may
//
// Why the delegation list lives in shift_settings and not on public.staff: staff is
// shared (middleware, both guards, the waiter app's is_staff_client() all read it),
// so a column there means every one of them has to learn about scheduling.

import type { AccessRow } from '@/lib/staff/access'
import { isOp } from '@/lib/staff/access'

export type ScheduleAccessRow = AccessRow & { id?: string | null }

/** View: any staff row (the caller has already been resolved as an active person). */
export function canViewSchedule(row: ScheduleAccessRow | null | undefined): boolean {
  return !!row
}

/** Manage: OP, general manager, or delegated via shift_settings.schedule_managers[]. */
export function canManageSchedule(row: ScheduleAccessRow | null | undefined, scheduleManagers: readonly string[]): boolean {
  if (!row) return false
  if (isOp(row)) return true
  if (row.badge === 'general_manager') return true
  return !!row.id && scheduleManagers.includes(row.id)
}

/** Delegate: OP / general manager only. */
export function canDelegateSchedule(row: ScheduleAccessRow | null | undefined): boolean {
  if (!row) return false
  return isOp(row) || row.badge === 'general_manager'
}

/** Route prefixes this module owns. Middleware imports these so the list lives in one place,
 *  the same way OP_ONLY_PREFIXES already does. */
export const SCHEDULE_MANAGER_PREFIX = '/owner/schedule'
export const SCHEDULE_STAFF_PREFIX = '/staff/schedule'

/** Both surfaces require a staff row at the middleware layer; the precise manage-vs-view split is
 *  re-checked server-side in the page, following the established "middleware is the first gate,
 *  not the only one" rule. */
export const SCHEDULE_PREFIXES = [SCHEDULE_MANAGER_PREFIX, SCHEDULE_STAFF_PREFIX]
