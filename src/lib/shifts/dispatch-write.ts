// Server-only. Performs one `ScheduleAction` against Supabase, using the
// caller's own session client — RLS is the real gate here, this file does
// not re-check `isManager` before a write (a non-manager's write is rejected
// by Postgres with 42501, which the route surfaces as a 400; see that file
// for why duplicating the check in JS would be redundant, not extra-safe).
//
// The five atomic operations (publish/unpublish/copy/clear a week, decide a
// swap) call their SQL function — see migration 027 and ACTION_ROUTES in
// adapter.ts for why those specifically must not be read-then-write here.
// Everything else is a guarded table write. Audit lines for these simple
// writes are NOT produced yet — `log_shift_audit()` is only called from
// inside the five RPCs today. That is a known gap against
// PLAN_SHIFTS.md Part I's "every mutation appears in the log" acceptance
// criterion, tracked for the warnings/roster phases rather than solved here.

import type { SupabaseClient } from '@supabase/supabase-js'
import { settingsPatchToRow, shiftPatchToRow } from './serialize'
import type { ScheduleAction } from './store'
import type { ISODate } from './types'

async function findWeekId(
  supabase: SupabaseClient, venueId: string, weekStart: ISODate,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('schedule_weeks').select('id')
    .eq('venue_id', venueId).eq('week_start', weekStart).maybeSingle()
  if (error) throw new Error(`week lookup: ${error.message}`)
  return (data?.id as string) ?? null
}

/** Idempotent — a second call for a week that already exists is a no-op read,
 *  not an error (mirrors the reducer's own `week.ensure`, which is also a
 *  silent no-op when the week is already there). */
async function ensureWeekId(
  supabase: SupabaseClient, venueId: string, weekStart: ISODate,
): Promise<string> {
  const existing = await findWeekId(supabase, venueId, weekStart)
  if (existing) return existing

  const { error: insErr } = await supabase
    .from('schedule_weeks')
    .upsert({ venue_id: venueId, week_start: weekStart },
      { onConflict: 'venue_id,week_start', ignoreDuplicates: true })
  if (insErr) throw new Error(`week ensure: ${insErr.message}`)

  const after = await findWeekId(supabase, venueId, weekStart)
  if (!after) throw new Error(`week ${weekStart}: not found after ensure`)
  return after
}

async function requireWeekId(
  supabase: SupabaseClient, venueId: string, weekStart: ISODate,
): Promise<string> {
  const id = await findWeekId(supabase, venueId, weekStart)
  if (!id) throw new Error(`week ${weekStart} does not exist`)
  return id
}

/** `shift_assignments.staff_name` is a snapshot, taken at write time — see
 *  migration 027's comment on that column. Read through `schedule_roster`,
 *  not `staff` directly: a manager's own session cannot read a colleague's
 *  `staff` row (RLS is self-only there), which is the entire reason that
 *  view exists. */
async function resolveStaffName(
  supabase: SupabaseClient, venueId: string, staffId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('schedule_roster').select('name')
    .eq('venue_id', venueId).eq('staff_id', staffId).maybeSingle()
  if (error) throw new Error(`staff name lookup: ${error.message}`)
  return (data?.name as string) ?? '—'
}

export async function performDispatch(
  supabase: SupabaseClient,
  ctx: { venueId: string; userId: string; staffId: string },
  action: ScheduleAction,
): Promise<void> {
  const { venueId, userId, staffId } = ctx

  switch (action.type) {
    case 'settings.update':
    case 'onboarding.complete': {
      const row = settingsPatchToRow(action.patch)
      row.updated_at = new Date().toISOString()
      row.updated_by = userId
      if (action.type === 'onboarding.complete') row.onboarded_at = new Date().toISOString()
      const { error } = await supabase.from('shift_settings').update(row).eq('venue_id', venueId)
      if (error) throw new Error(`settings update: ${error.message}`)
      return
    }

    case 'week.ensure': {
      await ensureWeekId(supabase, venueId, action.weekStart)
      return
    }

    case 'week.publish': {
      const weekId = await requireWeekId(supabase, venueId, action.weekStart)
      const { error } = await supabase.rpc('publish_schedule_week', { p_week: weekId })
      if (error) throw new Error(`publish: ${error.message}`)
      return
    }

    case 'week.unpublish': {
      const weekId = await requireWeekId(supabase, venueId, action.weekStart)
      const { error } = await supabase.rpc('unpublish_schedule_week', { p_week: weekId })
      if (error) throw new Error(`unpublish: ${error.message}`)
      return
    }

    case 'week.copy': {
      const { error } = await supabase.rpc('copy_schedule_week', {
        p_venue: venueId, p_from: action.from, p_to: action.to,
      })
      if (error) throw new Error(`copy week: ${error.message}`)
      return
    }

    case 'week.clear': {
      const weekId = await requireWeekId(supabase, venueId, action.weekStart)
      const { error } = await supabase.rpc('clear_schedule_week', { p_week: weekId })
      if (error) throw new Error(`clear week: ${error.message}`)
      return
    }

    case 'member.update': {
      // set_schedule_member() does the check + upsert + audit line
      // atomically — see its comment in migration 027 for why this one, out
      // of every simple write in this file, gets its own RPC rather than a
      // plain table write: shift_audit has no INSERT policy for a plain
      // authenticated write. p_patch is passed through as-is — it is
      // already keyed by the TS field names, and the RPC itself only
      // touches whichever keys are present (same "absent = unchanged"
      // contract as settingsPatchToRow above).
      const { error } = await supabase.rpc('set_schedule_member', {
        p_venue: venueId, p_staff: action.staffId, p_patch: action.patch,
      })
      if (error) throw new Error(`member update: ${error.message}`)
      return
    }

    case 'shift.create': {
      const weekId = await ensureWeekId(supabase, venueId, action.weekStart)
      const { error } = await supabase.from('shifts').insert({
        venue_id: venueId, week_id: weekId, shift_date: action.date,
        preset_id: action.presetId, start_time: action.start, end_time: action.end,
        station_id: action.stationId, requirements: action.requirements, note: '',
        created_by: userId,
      })
      if (error) throw new Error(`shift create: ${error.message}`)
      return
    }

    case 'shift.update': {
      const row = shiftPatchToRow(action.patch as Record<string, unknown>)
      const { error } = await supabase.from('shifts').update(row).eq('id', action.shiftId)
      if (error) throw new Error(`shift update: ${error.message}`)
      return
    }

    case 'shift.delete': {
      const { error } = await supabase.from('shifts').delete().eq('id', action.shiftId)
      if (error) throw new Error(`shift delete: ${error.message}`)
      return
    }

    case 'assignment.create': {
      const staffName = await resolveStaffName(supabase, venueId, action.staffId)
      const { error } = await supabase.from('shift_assignments').insert({
        venue_id: venueId, shift_id: action.shiftId, staff_id: action.staffId,
        staff_name: staffName, role_id: action.roleId, created_by: userId,
      })
      if (error) throw new Error(`assignment create: ${error.message}`)
      return
    }

    case 'assignment.delete': {
      const { error } = await supabase.from('shift_assignments').delete().eq('id', action.assignmentId)
      if (error) throw new Error(`assignment delete: ${error.message}`)
      return
    }

    case 'note.day': {
      const weekId = await ensureWeekId(supabase, venueId, action.weekStart)
      // jsonb read-modify-write: supabase-js has no partial-key jsonb update,
      // so this is a plain select-then-write. A race between two managers
      // editing two DIFFERENT days' notes in the same instant could clobber
      // one — rare enough (this is a manual, occasional action) not to be
      // worth a dedicated RPC for in this pass; flagged, not silently fine.
      const { data: current, error: selErr } = await supabase
        .from('schedule_weeks').select('day_notes').eq('id', weekId).single()
      if (selErr) throw new Error(`note lookup: ${selErr.message}`)
      const dayNotes = { ...(current?.day_notes as Record<string, string> | null ?? {}) }
      if (action.note.trim()) dayNotes[action.date] = action.note
      else delete dayNotes[action.date]
      const { error } = await supabase.from('schedule_weeks').update({ day_notes: dayNotes }).eq('id', weekId)
      if (error) throw new Error(`note update: ${error.message}`)
      return
    }

    case 'warning.dismiss': {
      // Same read-modify-write shape as note.day above, and the same
      // reasoning applies: rare, manual, occasional collision risk accepted
      // rather than worth a dedicated RPC.
      const weekId = await ensureWeekId(supabase, venueId, action.weekStart)
      const { data: current, error: selErr } = await supabase
        .from('schedule_weeks').select('dismissed_warnings').eq('id', weekId).single()
      if (selErr) throw new Error(`dismiss lookup: ${selErr.message}`)
      const existing = (current?.dismissed_warnings as string[] | null) ?? []
      const has = existing.includes(action.warningId)
      const dismissedWarnings = action.dismissed
        ? (has ? existing : [...existing, action.warningId])
        : existing.filter((id) => id !== action.warningId)
      const { error } = await supabase.from('schedule_weeks')
        .update({ dismissed_warnings: dismissedWarnings }).eq('id', weekId)
      if (error) throw new Error(`dismiss update: ${error.message}`)
      return
    }

    case 'availability.submit': {
      // RLS (`shift_availability_own`) already restricts this to the
      // caller's own staff_id via its WITH CHECK clause — this is defense in
      // depth, checked first so a mismatched request fails with a clear
      // message instead of a raw Postgres RLS error.
      if (action.staffId !== staffId) {
        throw new Error('cannot submit availability for another staff member')
      }
      const { error } = await supabase.from('shift_availability').upsert({
        venue_id: venueId, staff_id: action.staffId, week_start: action.weekStart,
        entries: action.entries, note: action.note,
        status: 'submitted', submitted_at: new Date().toISOString(),
      }, { onConflict: 'venue_id,staff_id,week_start' })
      if (error) throw new Error(`availability submit: ${error.message}`)
      return
    }

    case 'swap.request': {
      // RLS (shift_swaps_create) already enforces this via WITH CHECK;
      // checked here too for a clean error rather than a raw RLS failure.
      if (action.fromStaffId !== staffId) {
        throw new Error('cannot request a swap on another staff member\'s behalf')
      }
      const { error } = await supabase.from('shift_swaps').insert({
        venue_id: venueId, assignment_id: action.assignmentId,
        from_staff_id: action.fromStaffId, to_staff_id: action.toStaffId,
        status: 'open', reason: action.reason,
      })
      if (error) throw new Error(`swap request: ${error.message}`)
      // The assignment flips to swap_pending client-side in the mock; here it
      // needs its own write (RLS lets the requester update their own
      // assignment's shift only via manager policy — so this one step is
      // deliberately done as a manager-independent, definer-backed op: reuse
      // is not available pre-migration-028+, so it is left assigned until a
      // manager or the swap's own decide-flow moves it). Tracked as a gap:
      // the swap_pending visual state does not yet reflect on the live shift
      // grid the instant a swap is requested — see PLAN_SHIFTS.md Part II
      // note under the Roster/Warnings phases if this needs closing sooner.
      return
    }

    case 'swap.peer_accept': {
      // Migration 027's shift_swaps_respond policy constrains WHICH ROW can
      // be updated (an open offer addressed to this person or to nobody in
      // particular) but its WITH CHECK does not constrain the NEW
      // `to_staff_id` value — RLS alone would let this write claim the swap
      // on behalf of anyone, not just the caller. Checked here explicitly;
      // see PLAN_SHIFTS.md Part II §21 for the fuller note (swaps are
      // feature-flagged off by default, so this has never been reachable
      // with a real venue, but it is a genuine gap worth closing before
      // ENABLE_SHIFT_SWAPS is ever turned on for one).
      if (action.staffId !== staffId) {
        throw new Error('cannot accept a swap on another staff member\'s behalf')
      }
      const { error } = await supabase.from('shift_swaps').update({
        status: 'peer_accepted', to_staff_id: action.staffId,
        peer_responded_at: new Date().toISOString(),
      }).eq('id', action.swapId)
      if (error) throw new Error(`swap accept: ${error.message}`)
      return
    }

    case 'swap.decide': {
      const { error } = await supabase.rpc('decide_shift_swap', {
        p_swap: action.swapId, p_approve: action.approve, p_note: action.note,
      })
      if (error) throw new Error(`swap decide: ${error.message}`)
      return
    }

    case 'swap.cancel': {
      const { error } = await supabase.from('shift_swaps')
        .update({ status: 'cancelled' }).eq('id', action.swapId)
      if (error) throw new Error(`swap cancel: ${error.message}`)
      return
    }

    default: {
      const _exhaustive: never = action
      throw new Error(`unhandled action: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
