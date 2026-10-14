// What the developer's dashboard checks (/owner/dev) — "is the system the way
// I think it is?" in a dozen lines. Server-only, service role, and, like
// signals.ts, every read swallows its own failure: a broken check becomes a
// red row, never a broken page.
//
// The point of the migration rows is that THREE of this project's migrations
// are drafted-not-applied at any given time and `list_migrations` is documented
// as unreliable here (CLAUDE.md: only three are recorded in Supabase's own
// table). Probing for the OBJECT a migration creates is the check that is true.

import { createServiceClient } from '@/lib/supabase/server'
import {
  TABLE_ORDERING_ENABLED, TABLE_ORDERING_ENABLED_DEFAULT,
  WAITER_CALL_ENABLED, WAITER_CALL_ENABLED_DEFAULT,
} from '@/lib/settings/keys'
import { isMissingTable } from '@/lib/zreport/server'

export type HealthState = 'ok' | 'warn' | 'bad' | 'info'
export interface HealthRow { id: string; label: string; state: HealthState; detail: string }

type Service = ReturnType<typeof createServiceClient>

const MISSING_FN = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '42883' || e.code === 'PGRST202' || /could not find the function|does not exist/i.test(e.message ?? ''))

async function safe(id: string, label: string, fn: () => Promise<Omit<HealthRow, 'id' | 'label'>>): Promise<HealthRow> {
  try {
    return { id, label, ...(await fn()) }
  } catch (e) {
    return { id, label, state: 'bad', detail: e instanceof Error ? e.message : 'הבדיקה נכשלה' }
  }
}

export async function readDevHealth(): Promise<HealthRow[]> {
  let service: Service
  try {
    service = createServiceClient()
  } catch {
    return [{ id: 'client', label: 'חיבור למסד הנתונים', state: 'bad', detail: 'חסרים משתני סביבה של Supabase' }]
  }

  const rows = await Promise.all([
    safe('db', 'מסד הנתונים', async () => {
      const { error } = await service.from('app_settings').select('key').limit(1)
      return error ? { state: 'bad', detail: error.message } : { state: 'ok', detail: 'מגיב' }
    }),

    safe('m056', 'מיגרציה 056 — ארכיון דוחות Z', async () => {
      const { error } = await service.from('z_reports').select('id').limit(1)
      if (!error) return { state: 'ok', detail: 'הטבלה קיימת' }
      return isMissingTable(error)
        ? { state: 'warn', detail: 'עדיין לא הופעלה — אי אפשר להעלות דוח Z' }
        : { state: 'bad', detail: error.message }
    }),

    safe('m057', 'מיגרציה 057 — קריאת מלצר וסנכרון סידור', async () => {
      // A harmless probe: with no signed-in user it just returns false. A
      // missing function is the signal.
      const { error } = await service.rpc('waiter_is_call_recipient')
      if (!error) return { state: 'ok', detail: 'הפונקציות קיימות' }
      return MISSING_FN(error)
        ? { state: 'warn', detail: 'עדיין לא הופעלה — הקופה לא תקבל קריאות וההכרזות לא יפעלו' }
        : { state: 'bad', detail: error.message }
    }),

    // Onboarding join links + the payslip library (2026-10-14). Probing for the OBJECT each migration creates.
    safe('m059', 'מיגרציה 059 — קישורי הצטרפות לצוות', async () => {
      const { error } = await service.from('staff_join_links').select('id').limit(1)
      if (!error) return { state: 'ok', detail: 'הטבלה קיימת' }
      return isMissingTable(error)
        ? { state: 'warn', detail: 'עדיין לא הופעלה — אי אפשר ליצור קישורי הצטרפות' }
        : { state: 'bad', detail: error.message }
    }),

    safe('m060', 'מיגרציה 060 — ספריית תלושי שכר', async () => {
      const { error } = await service.from('staff_payslips').select('id').limit(1)
      if (!error) return { state: 'ok', detail: 'הטבלה קיימת' }
      return isMissingTable(error)
        ? { state: 'warn', detail: 'עדיין לא הופעלה — אי אפשר להעלות או לצפות בתלושים' }
        : { state: 'bad', detail: error.message }
    }),

    safe('call-switch', 'מתג "קריאה למלצר" בתפריט', async () => {
      const { data } = await service.from('app_settings').select('value').eq('key', WAITER_CALL_ENABLED).maybeSingle()
      const on = (data?.value as boolean | undefined) ?? WAITER_CALL_ENABLED_DEFAULT
      return { state: 'info', detail: on ? 'דלוק — הלקוחות יכולים לקרוא למלצר' : 'כבוי (ברירת המחדל)' }
    }),

    // Remote ordering (2026-10-13). Probing for the OBJECT the migration creates, as above.
    safe('m058', 'מיגרציה 058 — הזמנה מרחוק', async () => {
      // Service-role-only and harmless: it just lists who is on shift. A missing function is the signal.
      const { error } = await service.rpc('waiter_call_recipient_staff_ids')
      if (!error) return { state: 'ok', detail: 'הפונקציות קיימות' }
      return MISSING_FN(error)
        ? { state: 'warn', detail: 'עדיין לא הופעלה — אי אפשר לחבר לקוח לשולחן, והקופה לא תציג הזמנות' }
        : { state: 'bad', detail: error.message }
    }),

    safe('order-switch', 'מתג "שליחת הזמנה למלצר" בתפריט', async () => {
      const { data } = await service.from('app_settings').select('value').eq('key', TABLE_ORDERING_ENABLED).maybeSingle()
      const on = (data?.value as boolean | undefined) ?? TABLE_ORDERING_ENABLED_DEFAULT
      return { state: 'info', detail: on ? 'דלוק — לקוח עם קוד מהמלצר יכול לשלוח הזמנה' : 'כבוי (ברירת המחדל)' }
    }),

    safe('push', 'התראות דחיפה (VAPID)', async () => {
      // Presence only — never the values. Without all three, order alerts simply do not buzz; the POS's own
      // polling still shows every request.
      const keys = ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
      const missing = keys.filter((k) => !process.env[k])
      if (missing.length) return { state: 'warn', detail: `חסרים משתני סביבה: ${missing.join(', ')}` }
      // `app` exists only once 058 is applied; before that every subscription is the portal's.
      const { data, error } = await service.from('staff_push_subscriptions').select('app')
      if (error) {
        const { count } = await service.from('staff_push_subscriptions').select('id', { count: 'exact', head: true })
        return { state: 'ok', detail: `המפתחות קיימים · ${count ?? 0} מכשירים רשומים (לפני 058: הכול באתר)` }
      }
      const oms = (data ?? []).filter((r) => r.app === 'oms').length
      const portal = (data ?? []).length - oms
      return { state: 'ok', detail: `המפתחות קיימים · ${portal} מכשירים באתר · ${oms} בקופה` }
    }),

    safe('pos', 'משמרת במערכת הקופה', async () => {
      const { data, error } = await service.from('waiter_shift_sessions').select('started_at').eq('status', 'active').limit(1)
      if (error) return { state: 'bad', detail: error.message }
      return data?.length
        ? { state: 'ok', detail: 'פתוחה' }
        : { state: 'info', detail: 'סגורה — אין קבלת הזמנות וקריאות' }
    }),

    safe('schedule', 'סידור עבודה מפורסם', async () => {
      const { data, error } = await service
        .from('schedule_weeks').select('week_start').eq('status', 'published')
        .gte('week_start', new Date(Date.now() - 8 * 86_400_000).toISOString().slice(0, 10)).limit(5)
      if (error) return { state: 'bad', detail: error.message }
      return data?.length
        ? { state: 'ok', detail: `${data.length} שבועות מפורסמים בטווח` }
        : { state: 'info', detail: 'אין סידור מפורסם — הקופה מתנהגת כאילו אין סידור (כל הצוות מקבל קריאות)' }
    }),

    safe('staff', 'צוות', async () => {
      const { data, error } = await service.from('staff').select('auth_user_id, email, active')
      if (error) return { state: 'bad', detail: error.message }
      const active = (data ?? []).filter((s) => s.active)
      const linked = active.filter((s) => s.auth_user_id).length
      const pending = active.filter((s) => !s.auth_user_id && s.email).length
      const offline = active.filter((s) => !s.auth_user_id && !s.email).length
      return { state: 'info', detail: `${active.length} פעילים · ${linked} מחוברים · ${pending} ממתינים להזמנה · ${offline} בלי חשבון` }
    }),
  ])

  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7)
  rows.push({
    id: 'build', label: 'גרסה פרוסה', state: 'info',
    detail: [process.env.VERCEL_ENV ?? process.env.NODE_ENV, sha || null].filter(Boolean).join(' · ') || 'לא ידוע',
  })
  return rows
}
