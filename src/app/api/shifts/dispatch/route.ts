import { NextRequest, NextResponse } from 'next/server'
import { requireScheduleApi } from '@/lib/shifts/guard'
import { performDispatch } from '@/lib/shifts/dispatch-write'
import { loadShiftsState } from '@/lib/shifts/state-query'
import type { ScheduleAction } from '@/lib/shifts/store'

// One `ScheduleAction` in, the fresh windowed `ShiftsDB` back out — a
// re-read of what actually landed in Postgres, not an optimistic merge of
// the action onto the client's prior state. Slightly more latency than
// optimistic updates, considerably fewer ways for the UI to drift from what
// the database actually holds, which for a shared draft several people can
// edit is the trade worth making. `weekStart` in the body is the window to
// re-fetch afterward — it is NOT necessarily the action's own week (an
// assignment.delete carries no week at all), so the caller (supabase-source.ts)
// resolves it and sends it explicitly.
//
// Authorization is RLS, not a branch here on `auth.isManager` — see
// dispatch-write.ts's header. A write a non-manager isn't allowed to make
// fails in Postgres with 42501 and surfaces below as a 400.

export async function POST(request: NextRequest) {
  const auth = await requireScheduleApi()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { action?: ScheduleAction; weekStart?: string } | null
  const action = body?.action
  const weekStart = body?.weekStart

  if (!action || typeof action.type !== 'string') {
    return NextResponse.json({ error: 'missing action' }, { status: 400 })
  }
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'missing or invalid weekStart' }, { status: 400 })
  }

  try {
    await performDispatch(
      auth.auth.supabase,
      { venueId: auth.auth.venueId, userId: auth.auth.userId, staffId: auth.auth.staffId },
      action,
    )
    const db = await loadShiftsState(auth.auth.supabase, auth.auth.venueId, weekStart)
    return NextResponse.json(db)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'dispatch failed' },
      { status: 400 },
    )
  }
}
