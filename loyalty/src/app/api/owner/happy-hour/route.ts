import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/owner/guard'
import { SETTINGS_TAG, HAPPY_HOUR_KEY } from '@/lib/settings/keys'
import { MENU_SLUG, loc, type MenuCategory } from '@/lib/menu/types'
import { HAPPY_HOUR_DEFAULT, type HappyHour, type HappyHourRule } from '@/lib/menu/variants'
import { logAudit } from '@/lib/owner/audit'

/** Which categories the discounted items belong to, by name — an audit line
 *  reading "8 items" is far less useful than "קוקטיילים, בירות". */
async function categoryNamesFor(service: SupabaseClient, itemIds: string[]): Promise<string[]> {
  if (!itemIds.length) return []
  try {
    const { data } = await service
      .from('menus').select('draft').eq('slug', MENU_SLUG).single()
    const cats = (data?.draft?.categories ?? []) as MenuCategory[]
    const wanted = new Set(itemIds)
    return cats
      .filter((c) => (c.items ?? []).some((i) => i.uid && wanted.has(i.uid)))
      .map((c) => loc(c.title, 'he'))
      .filter(Boolean)
  } catch {
    return []
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Validate hard: this writes prices customers read. A malformed percent or a
 *  rule pointing at nothing is worth a 400, not a silently broken menu. */
function parse(input: unknown): { ok: true; value: HappyHour } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'ערך לא תקין' }
  const o = input as Record<string, unknown>

  if (typeof o.enabled !== 'boolean') return { ok: false, error: 'ערך לא תקין' }
  if (typeof o.start !== 'string' || !TIME_RE.test(o.start)) return { ok: false, error: 'שעת התחלה לא תקינה' }
  if (typeof o.end !== 'string' || !TIME_RE.test(o.end)) return { ok: false, error: 'שעת סיום לא תקינה' }
  if (!Array.isArray(o.rules)) return { ok: false, error: 'ערך לא תקין' }

  const rules: HappyHourRule[] = []
  for (const raw of o.rules) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'כלל לא תקין' }
    const r = raw as Record<string, unknown>
    if (r.scope !== 'category' && r.scope !== 'item') return { ok: false, error: 'כלל לא תקין' }
    if (typeof r.id !== 'string' || !r.id) return { ok: false, error: 'כלל לא תקין' }
    const percent = Number(r.percent)
    if (!Number.isFinite(percent) || percent < 1 || percent > 90) {
      return { ok: false, error: 'ההנחה חייבת להיות בין 1% ל-90%' }
    }
    rules.push({ scope: r.scope, id: r.id, percent: Math.round(percent) })
  }

  // Turning it ON with nothing selected would advertise a happy hour that
  // discounts nothing — refuse rather than confuse customers.
  if (o.enabled && rules.length === 0) {
    return { ok: false, error: 'יש לבחור לפחות קטגוריה או פריט אחד' }
  }

  return { ok: true, value: { enabled: o.enabled, start: o.start, end: o.end, rules } }
}

export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('app_settings').select('value').eq('key', HAPPY_HOUR_KEY).maybeSingle()

  if (error) return NextResponse.json({ error: 'טעינת ההגדרות נכשלה' }, { status: 500 })
  return NextResponse.json({ happyHour: (data?.value as HappyHour | undefined) ?? HAPPY_HOUR_DEFAULT })
}

export async function PUT(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null)
  const parsed = parse((body as { happyHour?: unknown } | null)?.happyHour)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data, error } = await auth.service
    .from('app_settings')
    .upsert({
      key: HAPPY_HOUR_KEY,
      value: parsed.value,
      is_public: true, // the signed-out menu applies the discount
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    }, { onConflict: 'key' })
    .select('value')
    .single()

  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })

  revalidateTag(SETTINGS_TAG)

  // Record the window, the discount and what it covers — the owner needs to be
  // able to answer "who put 50% on the cocktails and when".
  const hh = parsed.value
  const percents = Array.from(new Set(hh.rules.map((r) => r.percent)))
  await logAudit(auth.service, auth.userId, 'happy_hour.update',
    hh.enabled
      ? `הפעיל/ה Happy Hour ${hh.start}–${hh.end} · ${percents.join('/')}% על ${hh.rules.length} פריטים`
      : `כיבה/תה את ה-Happy Hour`,
    {
      enabled: hh.enabled,
      start: hh.start,
      end: hh.end,
      percents,
      itemCount: hh.rules.length,
      categories: await categoryNamesFor(auth.service, hh.rules.map((r) => r.id)),
    })

  return NextResponse.json({ happyHour: data.value as HappyHour })
}
