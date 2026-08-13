// The seam between this module and wherever its data actually lives.
//
// The prototype runs on `mock.ts` (browser memory + localStorage). Production
// runs on a Supabase-backed implementation of the SAME interface, and the swap
// is one line in `ShiftsProvider`. Everything above this file — the builder,
// the rules engine, the print sheet, the staff view — is written against the
// interface and never learns which one it got.
//
// `ACTION_ROUTES` is the contract for that second implementation: every action
// variant, and the server surface that will carry it. It is a table rather
// than prose because the compiler checks it — adding an action without
// deciding how it travels is a type error, not an oversight discovered later.

import type { ScheduleAction, ShiftsDB } from './store'

export interface ShiftsDataSource {
  /** Everything the manager surfaces need, in one read. */
  load(): Promise<ShiftsDB>
  /** Apply one action and return the resulting state. The implementation owns
   *  the clock, the ids and the audit write — which is why the reducer takes
   *  those as context rather than reaching for them. */
  dispatch(action: ScheduleAction): Promise<ShiftsDB>
  /** True for the mock. The UI shows a prototype banner when set, so nobody
   *  mistakes demo data for the real roster. */
  readonly isMock: boolean
}

/**
 * Where each action goes once this is server-backed.
 *
 * Two rules carried over from the rest of the app:
 *   1. Every one of these is a WRITE by a privileged user, so each route
 *      guards with a schedule-manager check — `requireStaff()` is not enough,
 *      exactly as `lib/owner/guard.ts` documents for the owner routes.
 *   2. The four that change staffing atomically (publish, copy, swap decide,
 *      week clear) belong in SQL functions, not in a route handler doing
 *      read-then-write. The redeem endpoint was broken that way once; a
 *      publish that races an edit would corrupt what the team sees.
 */
export const ACTION_ROUTES: Record<ScheduleAction['type'], { method: 'POST' | 'PATCH' | 'DELETE'; path: string; rpc?: string }> = {
  'settings.update':      { method: 'PATCH',  path: '/api/shifts/settings' },
  'onboarding.complete':  { method: 'POST',   path: '/api/shifts/settings/onboard' },
  'week.ensure':          { method: 'POST',   path: '/api/shifts/weeks' },
  'week.publish':         { method: 'POST',   path: '/api/shifts/weeks/publish',   rpc: 'publish_schedule_week' },
  'week.unpublish':       { method: 'POST',   path: '/api/shifts/weeks/unpublish', rpc: 'unpublish_schedule_week' },
  'week.copy':            { method: 'POST',   path: '/api/shifts/weeks/copy',      rpc: 'copy_schedule_week' },
  'week.clear':           { method: 'DELETE', path: '/api/shifts/weeks/shifts',    rpc: 'clear_schedule_week' },
  'shift.create':         { method: 'POST',   path: '/api/shifts/shifts' },
  'shift.update':         { method: 'PATCH',  path: '/api/shifts/shifts' },
  'shift.delete':         { method: 'DELETE', path: '/api/shifts/shifts' },
  'assignment.create':    { method: 'POST',   path: '/api/shifts/assignments' },
  'assignment.delete':    { method: 'DELETE', path: '/api/shifts/assignments' },
  'note.day':             { method: 'PATCH',  path: '/api/shifts/weeks/note' },
  'availability.submit':  { method: 'POST',   path: '/api/shifts/availability' },
  'swap.request':         { method: 'POST',   path: '/api/shifts/swaps' },
  'swap.peer_accept':     { method: 'POST',   path: '/api/shifts/swaps/accept' },
  'swap.decide':          { method: 'POST',   path: '/api/shifts/swaps/decide',    rpc: 'decide_shift_swap' },
  'swap.cancel':          { method: 'POST',   path: '/api/shifts/swaps/cancel' },
}
