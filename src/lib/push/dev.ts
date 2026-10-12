// The owner's notification test bench ("test notifications on myself").
//
// A template does not call the push service directly: it writes a real inbox row for the owner
// and flushes, so what is exercised is the production road end to end (inbox -> outbox claim ->
// web push -> service worker -> tap target). Rows are stamped as read so they never inflate the
// owner's unread badge, and titled "(בדיקה)" so nobody mistakes them for real alerts.

import { createServiceClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import { ensureVapidConfigured } from './send'
import { flushStaffPush } from './staff'

type Service = ReturnType<typeof createServiceClient>
type Me = { id: string; badge?: string | null; role?: string | null; email?: string | null }

/** Full admin only (OP): the bench writes real inbox rows and reports on the server's push setup. */
export function isPushDeveloper(me: { badge?: string | null; role?: string | null } | null | undefined): boolean {
  return !!me && isOp(me)
}

type Template = { kind: string; title: string; body: string; url: string }
const TEMPLATES: Record<string, Template[]> = {
  schedule: [{ kind: 'schedule.published', title: 'הסידור פורסם (בדיקה)', body: 'הסידור לשבוע הקרוב פורסם. כדאי לבדוק את המשמרות שלך.', url: '/staff/schedule' }],
  shift_soon: [{ kind: 'shift.soon', title: 'המשמרת שלך מתחילה בקרוב (בדיקה)', body: '18:00–01:00', url: '/staff/schedule' }],
  open_shift: [{ kind: 'swap.open', title: 'דנה מוסר/ת משמרת (בדיקה)', body: 'יום ג׳ 18:00–01:00\nמי שפנוי/ה יכול/ה לקחת אותה בלשונית הבקשות.', url: '/staff/schedule' }],
  swap_request: [{ kind: 'swap.request', title: 'דנה מבקש/ת להחליף איתך משמרת (בדיקה)', body: 'יום ד׳ 18:00–01:00 מול יום ה׳ 21:00–03:00', url: '/staff/schedule' }],
  // More than three at once: the phone gets one summary instead of a burst.
  digest: [
    { kind: 'schedule.published', title: 'הסידור פורסם (בדיקה)', body: '', url: '/staff/schedule' },
    { kind: 'shift.soon', title: 'המשמרת שלך מתחילה בקרוב (בדיקה)', body: '', url: '/staff/schedule' },
    { kind: 'swap.open', title: 'דנה מוסר/ת משמרת (בדיקה)', body: '', url: '/staff/schedule' },
    { kind: 'swap.request', title: 'דנה מבקש/ת להחליף איתך משמרת (בדיקה)', body: '', url: '/staff/schedule' },
  ],
}
export const DEV_TEMPLATE_IDS = Object.keys(TEMPLATES) as [string, ...string[]]

export async function devPushStatus(service: Service, me: Me) {
  const [devices, unsent, cron] = await Promise.all([
    service.from('staff_push_subscriptions').select('user_agent, created_at, last_seen_at').eq('staff_id', me.id).order('created_at', { ascending: false }),
    service.from('schedule_notifications').select('id', { count: 'exact', head: true }).is('push_sent_at', null),
    service.rpc('staff_push_cron_status'),
  ])
  return {
    vapidConfigured: ensureVapidConfigured(),
    devices: (devices.data ?? []).map((d) => ({ userAgent: (d.user_agent as string | null) ?? '', createdAt: d.created_at as string, lastSeenAt: d.last_seen_at as string })),
    waiting: unsent.count ?? 0,
    cron: cron.error ? { available: false } : (cron.data as Record<string, unknown>),
  }
}

export async function devSendTemplate(service: Service, me: Me, template: string): Promise<{ inserted: number; claimed: number; sent: number; devices: number }> {
  const rows = TEMPLATES[template]
  if (!rows) return { inserted: 0, claimed: 0, sent: 0, devices: 0 }
  const { data: venue } = await service.from('venues').select('id').eq('active', true).order('created_at', { ascending: true }).limit(1).maybeSingle()
  const venueId = (venue?.id as string | undefined) ?? null
  if (!venueId) return { inserted: 0, claimed: 0, sent: 0, devices: 0 }

  const now = new Date().toISOString()
  const { data: inserted, error } = await service
    .from('schedule_notifications')
    .insert(rows.map((row) => ({ venue_id: venueId, staff_id: me.id, kind: row.kind, title: row.title, body: row.body, link: { url: row.url }, read_at: now })))
    .select('id')
  if (error) throw error
  const { count } = await service.from('staff_push_subscriptions').select('id', { count: 'exact', head: true }).eq('staff_id', me.id)
  const push = await flushStaffPush()
  return { inserted: inserted?.length ?? 0, claimed: push.claimed, sent: push.sent, devices: count ?? 0 }
}
