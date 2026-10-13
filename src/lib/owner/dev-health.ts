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
import { WAITER_CALL_ENABLED, WAITER_CALL_ENABLED_DEFAULT } from '@/lib/settings/keys'
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

    safe('call-switch', 'מתג "קריאה למלצר" בתפריט', async () => {
      const { data } = await service.from('app_settings').select('value').eq('key', WAITER_CALL_ENABLED).maybeSingle()
      const on = (data?.value as boolean | undefined) ?? WAITER_CALL_ENABLED_DEFAULT
      return { state: 'info', detail: on ? 'דלוק — הלקוחות יכולים לקרוא למלצר' : 'כבוי (ברירת המחדל)' }
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
