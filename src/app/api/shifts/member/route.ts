import { NextRequest, NextResponse } from 'next/server'
import { requireScheduleApi } from '@/lib/shifts/guard'
import { performDispatch } from '@/lib/shifts/dispatch-write'

// A dedicated write for StaffManager.tsx on /owner/dashboard — the one
// caller in this module that needs to write a schedule_members row but has
// no <ShiftsProvider> and no week in view, so it cannot go through
// `/api/shifts/dispatch` the way every schedule surface does (that route
// always re-reads the 3-week window afterward, which StaffManager has
// nowhere to put). This route performs the exact same `member.update`
// action through the exact same `performDispatch()` — one write path, not
// two — and simply skips the re-read.
//
// Authorization is the same story as everywhere else in this module: RLS
// (via the set_schedule_member() RPC's own is_schedule_manager() check) is
// the real gate, not a JS branch here.

export async function POST(request: NextRequest) {
  const auth = await requireScheduleApi()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { staffId?: string; schedulable?: boolean } | null
  if (!body?.staffId || typeof body.schedulable !== 'boolean') {
    return NextResponse.json({ error: 'missing staffId or schedulable' }, { status: 400 })
  }

  try {
    await performDispatch(
      auth.auth.supabase,
      { venueId: auth.auth.venueId, userId: auth.auth.userId, staffId: auth.auth.staffId },
      { type: 'member.update', staffId: body.staffId, patch: { schedulable: body.schedulable } },
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'update failed' },
      { status: 400 },
    )
  }
}
