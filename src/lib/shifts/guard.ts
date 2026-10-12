// Server-only auth guards for shift scheduling. This is the PRIMARY authorization layer
// for every shifts API route and page: it re-resolves the caller from the session via
// the service-role client (staff has no select policy for authenticated), independent of
// whatever middleware already decided. The sched_* SQL functions (migration 052)
// re-check the matching action-specific rule from the explicit actor id as a second layer.
//
// Nothing here ever trusts an id from a request body: the actor is always the
// signed-in person, and the venue is the one this install runs.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { Unauthorized, Forbidden } from '@/lib/http/errors'
import { canDelegateSchedule, canManageSchedule, canViewSchedule } from '@/lib/shifts/access'
import { resolveStaffIdentity, type StaffRow } from '@/lib/staff/session'

export type { StaffRow }

/** The one venue this install runs — the first active `venues` row (no venue switcher exists yet). */
export async function getActiveVenue(): Promise<{ id: string; slug: string; timezone: string; name: string } | null> {
  const { data } = await createServiceClient()
    .from('venues')
    .select('id, slug, timezone, name')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  const name = (data.name as { he?: string } | string | null) ?? ''
  return {
    id: data.id as string,
    slug: data.slug as string,
    timezone: (data.timezone as string | null) || 'Asia/Jerusalem',
    name: typeof name === 'string' ? name : (name.he ?? ''),
  }
}

async function scheduleManagersOf(venueId: string): Promise<string[]> {
  const { data } = await createServiceClient().from('shift_settings').select('schedule_managers').eq('venue_id', venueId).maybeSingle()
  return (data?.schedule_managers as string[] | null) ?? []
}

export async function requireScheduleViewer(_venueId?: string): Promise<StaffRow> {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Unauthorized()
  if (!canViewSchedule(staff)) throw Forbidden('No access to the schedule.')
  return staff
}

/** Ayeka has a single venue, so reading the frozen published schedule needs nothing beyond being on the team. */
export const requirePublishedScheduleViewer = requireScheduleViewer

export async function requireScheduleManager(venueId: string): Promise<StaffRow> {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Unauthorized()
  if (!canManageSchedule(staff, await scheduleManagersOf(venueId))) throw Forbidden('Schedule-manager access required.')
  return staff
}

/** Owner / general manager only — the delegation itself (who else may manage). */
export async function requireScheduleDelegator(_venueId?: string): Promise<StaffRow> {
  const staff = await resolveStaffIdentity()
  if (!staff) throw Unauthorized()
  if (!canDelegateSchedule(staff)) throw Forbidden('Only an owner or general manager can choose who manages the schedule.')
  return staff
}

/** What a PAGE needs to decide where to send the visitor, resolved once. */
export type ScheduleContext = {
  staff: StaffRow
  venue: { id: string; slug: string; timezone: string; name: string }
  isManager: boolean
  canDelegate: boolean
}

/** Null when signed out / not on the team / no venue configured; the page maps that to a redirect. */
export async function resolveScheduleContext(): Promise<
  { ok: true; ctx: ScheduleContext } | { ok: false; reason: 'unauthenticated' | 'not_staff' | 'no_venue' }
> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthenticated' }
  const staff = await resolveStaffIdentity()
  if (!staff) return { ok: false, reason: 'not_staff' }
  const venue = await getActiveVenue()
  if (!venue) return { ok: false, reason: 'no_venue' }
  const managers = await scheduleManagersOf(venue.id)
  return { ok: true, ctx: { staff, venue, isManager: canManageSchedule(staff, managers), canDelegate: canDelegateSchedule(staff) } }
}
