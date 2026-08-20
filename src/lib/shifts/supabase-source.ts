// The live data source. Thin on purpose: every real query lives server-side
// in state-query.ts/dispatch-write.ts, reached through the two routes named
// in adapter.ts's ACTION_ROUTES — this class only knows how to call them.
// Parallel to MockShiftsSource in mock.ts, which is why `ShiftsProvider`
// can hold either behind the same `ShiftsDataSource` interface and switch
// on nothing more than which one it constructs.

import type { ShiftsDataSource } from './adapter'
import type { ScheduleAction, ShiftsDB } from './store'
import type { ISODate } from './types'

async function readJsonOrThrow(res: Response, verb: string): Promise<ShiftsDB> {
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `${verb} failed (${res.status})`)
  }
  return (await res.json()) as ShiftsDB
}

/** Which week a given action's own payload identifies, if any — so a
 *  navigation-triggering action (`week.ensure` when the user turns to a new
 *  week, `week.copy` landing on a new one) re-centers the window without the
 *  caller having to say so twice. Actions with no week of their own
 *  (`shift.update`, `assignment.*`, `swap.*`, `settings.update`, …) fall back
 *  to whatever window is already loaded — they never change which three
 *  weeks are in view. */
function weekStartOfAction(action: ScheduleAction): ISODate | undefined {
  switch (action.type) {
    case 'week.ensure':
    case 'week.publish':
    case 'week.unpublish':
    case 'week.clear':
    case 'shift.create':
    case 'note.day':
    case 'warning.dismiss':
    case 'availability.submit':
      return action.weekStart
    case 'week.copy':
      return action.to
    default:
      return undefined
  }
}

export class SupabaseShiftsSource implements ShiftsDataSource {
  readonly isMock = false
  private lastWeekStart: ISODate | null = null

  async load(weekStart: ISODate): Promise<ShiftsDB> {
    this.lastWeekStart = weekStart
    const res = await fetch(`/api/shifts/state?week=${encodeURIComponent(weekStart)}`, { cache: 'no-store' })
    return readJsonOrThrow(res, 'load')
  }

  async dispatch(action: ScheduleAction): Promise<ShiftsDB> {
    const weekStart = weekStartOfAction(action) ?? this.lastWeekStart
    if (!weekStart) throw new Error('SupabaseShiftsSource.dispatch() called before load()')
    this.lastWeekStart = weekStart

    const res = await fetch('/api/shifts/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, weekStart }),
    })
    return readJsonOrThrow(res, 'dispatch')
  }

  async refresh(): Promise<ShiftsDB> {
    if (!this.lastWeekStart) throw new Error('SupabaseShiftsSource.refresh() called before load()')
    return this.load(this.lastWeekStart)
  }
}
