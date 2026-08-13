// Who may rearrange the room.
//
// Sits on top of lib/staff/access.ts rather than beside it — the three
// existing levels (OP / menu editor / staff) are unchanged, and this adds one
// more capability, the same shape lib/shifts/access.ts uses for the schedule.
//
//   MANAGE FLOOR   OP
//                  OR badge = 'general_manager'
//                  OR badge = 'manager'        (shift manager)
//
// The shift manager is in, and that is deliberate: the layout changes when the
// room changes — a booth pulled out for a party, two tables joined — and that
// happens mid-service, when the owner is not there. It is not a menu-grade
// decision, and every layout save is snapshotted into waiter_floor_history
// with its actor, so a bad rearrangement is recoverable and attributable.
//
// ⚠️ MIRRORED IN SQL by `public.is_floor_manager()` (migration 022):
//
//     role = 'owner' or badge in ('owner', 'general_manager', 'manager')
//
// Change one and you must change the other. The database is the authority —
// this exists so the UI can hide a control the server would refuse, never so
// the UI can decide. `is_op()` and `isOp()` drifting apart is a bug this
// codebase has already paid for once.
//
// The same rule is mirrored a THIRD time in the waiter app
// (`ayeka-staff/src/access.ts`), because that is a separate repo with no
// shared package. Three copies is two too many, and the only thing keeping
// them honest is this comment and the SQL being the arbiter.

import { isOp, type AccessRow } from '@/lib/staff/access'

/** May edit the floor layout, add and remove tables, and set Owners/VIP. */
export function canManageFloor(row: AccessRow | null | undefined): boolean {
  if (!row) return false
  return isOp(row) || row.badge === 'general_manager' || row.badge === 'manager'
}

/** Owner-panel sections gated on floor management rather than on OP. Kept as
 *  a list so middleware and the dashboard agree on what is actually gated. */
export const FLOOR_PREFIXES = ['/owner/floor']
