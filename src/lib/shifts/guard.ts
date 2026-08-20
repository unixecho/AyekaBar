import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { ScheduleAccessRow } from './access'

// Server-side gates for the schedule surfaces — two pages, two API routes.
//
// Middleware is the first gate, not the only one — every /owner/* page in
// this app re-checks server-side, and these do too. Unlike the owner/staff
// guards elsewhere in the app (lib/owner/guard.ts), this module deliberately
// does NOT hand back a service-role client. Migration 027's whole point is
// that "the draft is manager-only" and "who is on the roster" are properties
// of the DATA MODEL, enforced by Postgres RLS — see PLAN_SHIFTS.md Part I
// decision D6 and Part II decision D9 — not a rule these guards have to
// remember. Using the caller's own session client everywhere keeps that
// guarantee real: a bug in a route here can misroute a request, but it
// cannot leak a row RLS wouldn't have returned anyway.
//
// This resolves identity (who is signed in, are they staff, which venue) and
// stops there for requireScheduleViewer(); requireScheduleManager() and the
// API-route guard additionally call `is_schedule_manager()` — live now that
// migration 027 is applied — which used to be the "one line standing between
// the prototype and a production gate" this file's previous version marked.

export interface ScheduleViewer {
  userId: string
  staff: ScheduleAccessRow
  name: string
  venueId: string
}

export interface ScheduleManagerViewer extends ScheduleViewer {
  isManager: true
}

/** Shared identity resolution. Returns null at whichever step fails so each
 *  caller (a page, which redirects, or an API route, which responds JSON)
 *  can react in its own idiom rather than this function picking one for
 *  both. */
async function resolveViewer(): Promise<
  | {
      ok: true; supabase: SupabaseClient; userId: string; userEmail: string | null
      staff: ScheduleAccessRow; name: string; venueId: string; isManager: boolean
    }
  | { ok: false; reason: 'unauthenticated' | 'not_staff' | 'no_venue' }
> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthenticated' }

  // RLS lets each user read exactly their own row, which is all this needs.
  const { data: me } = await supabase
    .from('staff')
    .select('id, role, badge, display_name, first_name, last_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // Signed in with Google is not the same as being staff — the distinction
  // the owner guard documents, and the reason /no-access exists.
  if (!me) return { ok: false, reason: 'not_staff' }

  // The one venue this install has, resolved live from the database rather
  // than the AYEKA_VENUE constant in config.ts — see PLAN_SHIFTS.md Part II
  // decision D13. No venue switcher exists yet, so "the first active venue"
  // is unambiguous; a second venue arriving is a UI decision, not a change
  // to this query's shape.
  const { data: venue } = await supabase
    .from('venues')
    .select('id')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!venue) return { ok: false, reason: 'no_venue' }

  const { data: isManager } = await supabase.rpc('is_schedule_manager', { p_venue: venue.id })

  const name = me.display_name?.trim()
    || [me.first_name, me.last_name].filter(Boolean).join(' ').trim()
    || me.email
    || user.email
    || '—'

  return {
    ok: true,
    supabase,
    userId: user.id,
    userEmail: user.email ?? null,
    staff: { id: me.id, role: me.role, badge: me.badge },
    name,
    venueId: venue.id as string,
    isManager: !!isManager,
  }
}

/** `/staff/schedule` — any signed-in staff member. What they can actually see
 *  from here on is governed entirely by RLS: `published_schedule` for
 *  everyone, `shift_availability`/`shift_swaps` for their own rows, nothing
 *  from the manager-only draft tables. */
export async function requireScheduleViewer(): Promise<ScheduleViewer> {
  const r = await resolveViewer()
  if (!r.ok) redirect(r.reason === 'unauthenticated' ? '/login' : '/no-access')
  return { userId: r.userId, staff: r.staff, name: r.name, venueId: r.venueId }
}

/** `/owner/schedule` — schedule managers only. A non-manager is sent to
 *  `/staff/schedule` rather than `/no-access`: they ARE staff, they simply
 *  cannot draft here — and now that migration 027's RLS is live, the draft
 *  genuinely returns zero rows to them, so leaving them on this page would
 *  render a broken, empty builder rather than a helpful read-only one. */
export async function requireScheduleManager(): Promise<ScheduleManagerViewer> {
  const r = await resolveViewer()
  if (!r.ok) redirect(r.reason === 'unauthenticated' ? '/login' : '/no-access')
  if (!r.isManager) redirect('/staff/schedule')
  return { userId: r.userId, staff: r.staff, name: r.name, venueId: r.venueId, isManager: true }
}

export interface ScheduleApiAuth {
  supabase: SupabaseClient
  userId: string
  userEmail: string | null
  staffId: string
  venueId: string
  isManager: boolean
}

export type ScheduleApiGuarded =
  | { ok: true; auth: ScheduleApiAuth }
  | { ok: false; res: NextResponse }

/** `/api/shifts/state` and `/api/shifts/dispatch` — any signed-in staff
 *  member may call these; `auth.isManager` tells the route which branch of
 *  work is legal, and RLS backs that up independently for every query and
 *  write either route makes. Returns JSON, not a redirect — this is a route
 *  handler, not a page. */
export async function requireScheduleApi(): Promise<ScheduleApiGuarded> {
  const r = await resolveViewer()
  if (!r.ok) {
    const status = r.reason === 'unauthenticated' ? 401 : 403
    const error = r.reason === 'unauthenticated' ? 'Unauthorized'
      : r.reason === 'not_staff' ? 'Not staff'
      : 'No venue configured'
    return { ok: false, res: NextResponse.json({ error }, { status }) }
  }
  return {
    ok: true,
    auth: {
      supabase: r.supabase, userId: r.userId, userEmail: r.userEmail,
      staffId: r.staff.id ?? '', venueId: r.venueId, isManager: r.isManager,
    },
  }
}
