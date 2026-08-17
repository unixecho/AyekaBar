import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'
import type { SupabaseClient } from '@supabase/supabase-js'

// Shift sessions for the owner dashboard (PLAN_OMS_V2.md item 13).
// waiter_shift_sessions/waiter_shift_reports (migration 034) had a schema
// and RLS but no UI anywhere until this — see STAFF_APP.md's entry the day
// this shipped. Deliberately NOT tied to src/lib/shifts/ (the roster
// planner) — that module has no live start/end concept of its own and its
// migration (027) is still unapplied; see 034's own migration header for
// the full reasoning.
//
// GET                    → recent sessions, newest first
// GET ?sessionId=<id>    → that session's station clock-in/out audit
//                          (migration 038 — "a full audit" of bartenders/
//                          cooks signing in and out of their station)
// POST {action:"start"} → open a new session (fails 23505 if one's already active)
// POST {action:"end"}   → close the currently active session, if any

// Two FKs from waiter_shift_sessions to staff (started_by/ended_by), and
// a third table (waiter_station_checkins) with its own staff_id, all
// resolved the same way: a separate id->name lookup, same posture
// waiter_staff_directory takes for "who is this id" everywhere else in
// this schema — an embedded PostgREST join across ambiguous/multiple FKs
// isn't reliably expressible.
async function nameLookup(service: SupabaseClient, ids: (string | null)[]) {
  const uniq = Array.from(new Set(ids.filter(Boolean))) as string[]
  const { data } = uniq.length
    ? await service.from('staff').select('id,display_name,first_name,last_name,email').in('id', uniq)
    : { data: [] as { id: string; display_name: string | null; first_name: string | null; last_name: string | null; email: string | null }[] }
  return (id: string | null) => {
    if (!id) return null
    const s = data?.find((r) => r.id === id)
    if (!s) return null
    return s.display_name?.trim() || [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || s.email || null
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const { service } = auth
  const sessionId = new URL(request.url).searchParams.get('sessionId')

  if (sessionId) {
    const { data, error } = await service
      .from('waiter_station_checkins')
      .select('id,staff_id,station,event,at')
      .eq('shift_session_id', sessionId)
      .order('at', { ascending: true })
    if (error) return NextResponse.json({ error: 'טעינת הכניסות נכשלה' }, { status: 500 })

    const nameOf = await nameLookup(service, (data ?? []).map((r) => r.staff_id))
    const checkins = (data ?? []).map((r) => ({ ...r, staff_name: nameOf(r.staff_id) }))
    return NextResponse.json({ checkins })
  }

  const { data, error } = await service
    .from('waiter_shift_sessions')
    .select('id,started_at,started_by,ended_at,ended_by,status')
    .order('started_at', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ error: 'טעינת המשמרות נכשלה' }, { status: 500 })

  const nameOf = await nameLookup(service, (data ?? []).flatMap((s) => [s.started_by, s.ended_by]))
  const sessions = (data ?? []).map((s) => ({
    ...s,
    started_by_name: nameOf(s.started_by),
    ended_by_name: nameOf(s.ended_by),
  }))

  return NextResponse.json({ sessions })
}

export async function POST(request: Request) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const { service, userId } = auth
  const body = await request.json().catch(() => ({}))

  // 034's trigger stamps started_by/ended_by from current_staff_id(), which
  // reads auth.uid() — null under the service role this route calls with,
  // so it stamps nothing here. Resolved explicitly instead, from the same
  // OP identity requireOwner() already verified.
  const { data: me } = await service.from('staff').select('id').eq('auth_user_id', userId).maybeSingle()
  const myStaffId = me?.id as string | undefined

  if (body.action === 'start') {
    const { data, error } = await service
      .from('waiter_shift_sessions')
      .insert({ started_by: myStaffId })
      .select('id,started_at,status')
      .single()
    if (error) {
      const conflict = error.code === '23505'
      return NextResponse.json(
        { error: conflict ? 'כבר יש משמרת פעילה' : 'פתיחת המשמרת נכשלה' },
        { status: conflict ? 409 : 500 }
      )
    }
    return NextResponse.json({ session: data })
  }

  if (body.action === 'end') {
    const { data: active } = await service
      .from('waiter_shift_sessions')
      .select('id')
      .eq('status', 'active')
      .maybeSingle()
    if (!active) return NextResponse.json({ error: 'אין משמרת פעילה' }, { status: 409 })

    const { data, error } = await service
      .from('waiter_shift_sessions')
      .update({ status: 'closed', ended_at: new Date().toISOString(), ended_by: myStaffId })
      .eq('id', active.id)
      .select('id,started_at,ended_at,status')
      .single()
    if (error) return NextResponse.json({ error: 'סגירת המשמרת נכשלה' }, { status: 500 })
    return NextResponse.json({ session: data })
  }

  return NextResponse.json({ error: 'פעולה לא מוכרת' }, { status: 400 })
}
