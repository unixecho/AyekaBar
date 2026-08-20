import { NextRequest, NextResponse } from 'next/server'
import { requireScheduleApi } from '@/lib/shifts/guard'
import { loadShiftsState } from '@/lib/shifts/state-query'

// The manager AND staff read, in one route — RLS narrows the response per
// caller (see state-query.ts's header), so this route does not branch on
// `auth.isManager` at all. `?week=YYYY-MM-DD` selects the 3-week window
// (that week, the one before, the one after) returned in the response; see
// SupabaseShiftsSource in supabase-source.ts for the client that calls this.

export async function GET(request: NextRequest) {
  const auth = await requireScheduleApi()
  if (!auth.ok) return auth.res

  const weekStart = request.nextUrl.searchParams.get('week')
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return NextResponse.json({ error: 'missing or invalid ?week=YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const db = await loadShiftsState(auth.auth.supabase, auth.auth.venueId, weekStart)
    return NextResponse.json(db)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'load failed' },
      { status: 500 },
    )
  }
}
