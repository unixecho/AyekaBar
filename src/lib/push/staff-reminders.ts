// The notifications nothing "happens" to trigger: a shift about to start. A scheduled run
// (api/cron/staff-push) writes them into the same inbox the rest of the scheduling system uses,
// so the in-app list and the phone push stay one story.
//
// Each reminder carries a dedupe_key and goes in with ignoreDuplicates, so running this every
// minute or every five, twice in a row or from two places, still produces each one exactly once.

import { createServiceClient } from '@/lib/supabase/server'
import { minutesUntilStart, wallClockNow } from '@/lib/shifts/time'
import type { WallClock } from '@/lib/shifts/types'
import { SHIFT_SOON_MINUTES } from './staff-rules'

type Service = ReturnType<typeof createServiceClient>
type Row = Record<string, unknown>
type NewRow = { venue_id: string; staff_id: string; kind: string; title: string; body: string; link: { url: string }; dedupe_key: string }

const dayMs = 24 * 60 * 60 * 1000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function insertReminders(service: Service, rows: NewRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await service.from('schedule_notifications').upsert(rows, { onConflict: 'staff_id,dedupe_key', ignoreDuplicates: true }).select('id')
  if (error) {
    console.error('staff reminders insert failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

type VenueClock = { name: string; clock: WallClock }
async function venueClocks(service: Service): Promise<Map<string, VenueClock>> {
  const { data } = await service.from('venues').select('id, name, timezone')
  return new Map(
    ((data ?? []) as Row[]).map((v) => [
      v.id as string,
      { name: (v.name as { he?: string } | null)?.he ?? '', clock: wallClockNow((v.timezone as string | null) || 'Asia/Jerusalem') },
    ])
  )
}

/** "Your shift starts in under an hour" — published shifts only, the same ones the staff home shows. */
async function shiftSoonReminders(service: Service, clocks: Map<string, VenueClock>): Promise<number> {
  const today = Date.now()
  const { data: shifts } = await service
    .from('shifts')
    .select('id, week_id, venue_id, shift_date, start_time, end_time')
    .gte('shift_date', isoDay(today - dayMs))
    .lte('shift_date', isoDay(today + dayMs))
  const near = ((shifts ?? []) as Row[]).filter((s) => {
    const clock = clocks.get(s.venue_id as string)?.clock
    if (!clock) return false
    const minutes = minutesUntilStart({ date: s.shift_date as string, startTime: s.start_time as string }, clock)
    return minutes > 0 && minutes <= SHIFT_SOON_MINUTES
  })
  if (near.length === 0) return 0

  const { data: published } = await service.from('schedule_weeks').select('id').in('id', [...new Set(near.map((s) => s.week_id as string))]).eq('status', 'published')
  const publishedIds = new Set(((published ?? []) as Row[]).map((w) => w.id as string))
  const live = near.filter((s) => publishedIds.has(s.week_id as string))
  if (live.length === 0) return 0

  const { data: assignments } = await service.from('shift_assignments').select('id, shift_id, staff_id').in('shift_id', live.map((s) => s.id as string)).not('staff_id', 'is', null)
  const byShift = new Map(live.map((s) => [s.id as string, s]))
  const rows: NewRow[] = []
  for (const a of (assignments ?? []) as Row[]) {
    const shift = byShift.get(a.shift_id as string)
    if (!shift) continue
    rows.push({
      venue_id: shift.venue_id as string,
      staff_id: a.staff_id as string,
      kind: 'shift.soon',
      title: 'המשמרת שלך מתחילה בקרוב',
      body: `${shift.start_time}–${shift.end_time}`,
      link: { url: '/staff/schedule' },
      dedupe_key: `shift-soon:${a.id}`,
    })
  }
  return insertReminders(service, rows)
}

export async function createStaffReminders(service: Service = createServiceClient()): Promise<{ shiftSoon: number }> {
  const clocks = await venueClocks(service)
  const shiftSoon = await shiftSoonReminders(service, clocks).catch((err) => (console.error('shift reminders failed:', err instanceof Error ? err.message : err), 0))
  return { shiftSoon }
}
