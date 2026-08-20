// The seam between this module and wherever its data actually lives.
//
// The prototype runs on `mock.ts` (browser memory + localStorage). Live data
// runs on `supabase-source.ts`, an implementation of the SAME interface, and
// `ShiftsProvider` picks between them (see that file). Everything above this
// file — the builder, the rules engine, the print sheet, the staff view — is
// written against the interface and never learns which one it got.
//
// `ACTION_ROUTES` is the contract for the live implementation: every action
// variant, and how it reaches the server. It is a table rather than prose
// because the compiler checks it — adding an action without deciding how it
// travels is a type error, not an oversight discovered later.
//
// REVISED 2026-08-20 (PLAN_SHIFTS.md Part II decision D10): originally one
// REST path per action (eighteen route files for an interface with exactly
// two methods). Now two routes total — `GET /api/shifts/state`,
// `POST /api/shifts/dispatch` — and this table names which RPC a dispatched
// action calls, not which path. See src/app/api/shifts/dispatch/route.ts and
// src/lib/shifts/dispatch-write.ts for what actually runs each row.

import type { ScheduleAction, ShiftsDB } from './store'
import type { ISODate } from './types'

export interface ShiftsDataSource {
  /** Everything a schedule surface needs for the 3-week window centred on
   *  `weekStart` (that week, the one before, the one after — see
   *  state-query.ts's header for why exactly that span). */
  load(weekStart: ISODate): Promise<ShiftsDB>
  /** Apply one action and return the resulting state. The implementation owns
   *  the clock, the ids and the audit write — which is why the reducer takes
   *  those as context rather than reaching for them. */
  dispatch(action: ScheduleAction): Promise<ShiftsDB>
  /** Re-read the currently loaded window without applying an action — for a
   *  passive poll (the roster panel refreshing "who's on staff now" on an
   *  interval and on window focus) where issuing a mutating action would be
   *  wrong. Re-fetches the same 3-week window `load()` last used. */
  refresh(): Promise<ShiftsDB>
  /** True for the mock. The UI shows a prototype banner when set, so nobody
   *  mistakes demo data for the real roster. */
  readonly isMock: boolean
}

/**
 * Which SQL function (if any) carries each action once it reaches the
 * server, and whether it is a manager-only write. Every action goes through
 * `POST /api/shifts/dispatch`; RLS is the actual enforcement of `managerOnly`
 * (see dispatch-write.ts's header) — this column exists so the table stays a
 * complete, compiler-checked map of "what can happen", the same job it did
 * before the route consolidation.
 */
export const ACTION_ROUTES: Record<ScheduleAction['type'], { managerOnly: boolean; rpc?: string }> = {
  'settings.update':      { managerOnly: true },
  'onboarding.complete':  { managerOnly: true },
  'week.ensure':          { managerOnly: true },
  'week.publish':         { managerOnly: true, rpc: 'publish_schedule_week' },
  'week.unpublish':       { managerOnly: true, rpc: 'unpublish_schedule_week' },
  'week.copy':            { managerOnly: true, rpc: 'copy_schedule_week' },
  'week.clear':           { managerOnly: true, rpc: 'clear_schedule_week' },
  'member.update':        { managerOnly: true, rpc: 'set_schedule_member' },
  'warning.dismiss':      { managerOnly: true },
  'shift.create':         { managerOnly: true },
  'shift.update':         { managerOnly: true },
  'shift.delete':         { managerOnly: true },
  'assignment.create':    { managerOnly: true },
  'assignment.delete':    { managerOnly: true },
  'note.day':             { managerOnly: true },
  'availability.submit':  { managerOnly: false },
  'swap.request':         { managerOnly: false },
  'swap.peer_accept':     { managerOnly: false },
  'swap.decide':          { managerOnly: true, rpc: 'decide_shift_swap' },
  'swap.cancel':          { managerOnly: false },
}
