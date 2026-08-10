import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireMenuEditor } from '@/lib/owner/guard'
import { MENU_SLUG, loc, type MenuCategory } from '@/lib/menu/types'
import { ensureUids } from '@/lib/menu/variants'
import { logAudit } from '@/lib/owner/audit'

// Owner-only CRUD for named menu variants ("רגיל" / "יום שישי") plus the
// switch for which one the public menu shows.

const COLS = 'id, name, excluded_uids, is_default, sort_order, schedule_enabled, schedule_days, schedule_start, schedule_end, active_until, expire_action'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** A temporary version can't be pinned up indefinitely — past this it isn't a
 *  "the cook is out tonight" menu any more, it's the menu. */
const MAX_TEMP_DAYS = 30

interface SchedulePatch {
  schedule_enabled: boolean
  schedule_days: number[]
  schedule_start: string | null
  schedule_end: string | null
}

/** Parse an incoming schedule. A version that claims to be scheduled but has
 *  no window would never apply — reject rather than store something inert. */
function parseSchedule(input: unknown):
  | { ok: true; value: SchedulePatch }
  | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'תזמון לא תקין' }
  const o = input as Record<string, unknown>
  const enabled = o.enabled === true

  if (!enabled) {
    return { ok: true, value: { schedule_enabled: false, schedule_days: [], schedule_start: null, schedule_end: null } }
  }

  if (typeof o.start !== 'string' || !TIME_RE.test(o.start)) return { ok: false, error: 'שעת התחלה לא תקינה' }
  if (typeof o.end !== 'string' || !TIME_RE.test(o.end)) return { ok: false, error: 'שעת סיום לא תקינה' }

  const days = Array.isArray(o.days)
    ? (o.days as unknown[])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    : []

  return {
    ok: true,
    value: {
      schedule_enabled: true,
      schedule_days: Array.from(new Set(days)).sort(),
      schedule_start: o.start,
      schedule_end: o.end,
    },
  }
}

interface TempPatch {
  active_until: string | null
  expire_action: 'revert' | 'delete'
}

const NO_TEMP: TempPatch = { active_until: null, expire_action: 'revert' }

/**
 * Parse a temporary-activation request: `{ until: ISO, deleteOnExpiry: bool }`,
 * or nothing at all for an ordinary permanent switch.
 *
 * The client sends an absolute instant rather than "4 hours" or "04:00" on
 * purpose — the deadline has to survive the owner's phone being on a different
 * timezone from the bar, and it's resolved against the bar clock before it
 * leaves the browser.
 */
function parseTemp(input: unknown):
  | { ok: true; value: TempPatch }
  | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, value: NO_TEMP }
  if (typeof input !== 'object') return { ok: false, error: 'תזמון לא תקין' }

  const o = input as Record<string, unknown>
  if (!o.until) return { ok: true, value: NO_TEMP }
  if (typeof o.until !== 'string') return { ok: false, error: 'זמן סיום לא תקין' }

  const t = Date.parse(o.until)
  if (!Number.isFinite(t)) return { ok: false, error: 'זמן סיום לא תקין' }

  const now = Date.now()
  // A minute of slack: the deadline is computed in the browser, so a slow
  // network or a phone clock a few seconds out shouldn't reject a valid "until
  // 4am". Anything actually in the past would expire the instant it was set.
  if (t <= now - 60_000) return { ok: false, error: 'זמן הסיום כבר עבר' }
  if (t > now + MAX_TEMP_DAYS * 86_400_000) {
    return { ok: false, error: `אפשר לתזמן עד ${MAX_TEMP_DAYS} יום קדימה` }
  }

  return {
    ok: true,
    value: {
      active_until: new Date(t).toISOString(),
      expire_action: o.deleteOnExpiry === true ? 'delete' : 'revert',
    },
  }
}

/** Resolve the single menu row, minting item uids the first time anything
 *  needs to reference an item. Doing it here rather than in a SQL backfill
 *  keeps the JSONB walk in one place and makes it idempotent — variants are
 *  useless without stable item identity. */
async function loadMenu(service: SupabaseClient) {
  const { data: pre, error: preError } = await service
    .from('menus').select('id').eq('slug', MENU_SLUG).single()
  if (preError || !pre) return null

  // Clear out versions whose timer has finished before reading anything back,
  // so the editor never shows last night's temporary menu as still live. This
  // is tidying, not correctness — the public menu stopped showing an expired
  // version the moment it expired, with or without this call. Ignored on
  // failure for the same reason: pre-017 databases don't have the function.
  await service.rpc('reap_expired_variants', { p_menu_id: pre.id })

  const { data, error } = await service
    .from('menus')
    .select('id, draft, published, active_variant_id')
    .eq('slug', MENU_SLUG)
    .single()
  if (error || !data) return null

  const draft = (data.draft?.categories ?? []) as MenuCategory[]
  const published = (data.published?.categories ?? []) as MenuCategory[]

  const d = ensureUids(draft)
  const p = ensureUids(published)

  if (d.changed || p.changed) {
    await service
      .from('menus')
      .update({
        ...(d.changed ? { draft: { ...data.draft, categories: d.categories } } : {}),
        ...(p.changed ? { published: { ...data.published, categories: p.categories } } : {}),
      })
      .eq('id', data.id)
  }

  return { id: data.id as string, activeVariantId: data.active_variant_id as string | null, categories: d.categories }
}

/**
 * Point the menu at a version, and make sure no OTHER version is still holding
 * a deadline. A stale `active_until` on a version nobody is showing is
 * harmless right up until the owner picks it again months later and it expires
 * immediately — so it's cleared here rather than left to surprise them.
 */
async function activateVariant(service: SupabaseClient, menuId: string, variantId: string) {
  await service
    .from('menu_variants')
    .update({ active_until: null, expire_action: 'revert' })
    .eq('menu_id', menuId)
    .neq('id', variantId)
    .not('active_until', 'is', null)

  return service.from('menus').update({ active_variant_id: variantId }).eq('id', menuId)
}

export async function GET() {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const menu = await loadMenu(auth.service)
  if (!menu) return NextResponse.json({ error: 'התפריט לא נמצא' }, { status: 404 })

  const { data, error } = await auth.service
    .from('menu_variants')
    .select(COLS)
    .eq('menu_id', menu.id)
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'טעינת הגרסאות נכשלה' }, { status: 500 })

  return NextResponse.json({
    variants: data ?? [],
    activeVariantId: menu.activeVariantId,
    categories: menu.categories,
  })
}

// ---- POST: create a variant ------------------------------------------------
export async function POST(request: NextRequest) {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { nameHe?: unknown; excludedUids?: unknown; schedule?: unknown; temp?: unknown } | null

  const nameHe = typeof body?.nameHe === 'string' ? body.nameHe.trim() : ''
  if (!nameHe) return NextResponse.json({ error: 'חסר שם לגרסה' }, { status: 400 })
  if (nameHe.length > 40) return NextResponse.json({ error: 'השם ארוך מדי' }, { status: 400 })

  const excluded = Array.isArray(body?.excludedUids)
    ? (body.excludedUids as unknown[]).filter((x): x is string => typeof x === 'string')
    : []

  const menu = await loadMenu(auth.service)
  if (!menu) return NextResponse.json({ error: 'התפריט לא נמצא' }, { status: 404 })

  const sched = parseSchedule(body?.schedule ?? { enabled: false })
  if (!sched.ok) return NextResponse.json({ error: sched.error }, { status: 400 })

  const temp = parseTemp(body?.temp)
  if (!temp.ok) return NextResponse.json({ error: temp.error }, { status: 400 })

  // A timed version goes live on save. Creating "בלי טבח" and then having to
  // find and tap it would be a second step for something that is, by
  // definition, needed right now.
  const goLive = temp.value.active_until !== null

  const { data, error } = await auth.service
    .from('menu_variants')
    .insert({
      menu_id: menu.id,
      name: { he: nameHe },
      excluded_uids: excluded,
      is_default: false,
      ...sched.value,
      ...temp.value,
    })
    .select(COLS)
    .single()

  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })

  if (goLive) {
    await activateVariant(auth.service, menu.id, data.id as string)
  }

  await logAudit(auth.service, auth.userId, 'variant.create',
    `יצר/ה גרסת תפריט: ${nameHe}`,
    {
      variantId: data.id, name: nameHe, hiddenItems: excluded.length,
      ...(goLive ? { until: temp.value.active_until, expireAction: temp.value.expire_action } : {}),
    })

  return NextResponse.json({
    variant: data,
    ...(goLive ? { activeVariantId: data.id } : {}),
  })
}

// ---- PATCH: rename / re-scope / activate ----------------------------------
export async function PATCH(request: NextRequest) {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    {
      id?: string; nameHe?: unknown; excludedUids?: unknown
      activate?: unknown; schedule?: unknown; temp?: unknown; makeDefault?: unknown
    } | null
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const menu = await loadMenu(auth.service)
  if (!menu) return NextResponse.json({ error: 'התפריט לא נמצא' }, { status: 404 })

  const { data: row } = await auth.service
    .from('menu_variants').select('id, is_default, name').eq('id', id).eq('menu_id', menu.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })

  const rowName = loc(row.name as Record<string, string>, 'he') || '—'

  // Promoting a version to "main" moves the thing every schedule and every
  // timer falls back to. One SQL call, because clearing the old main and
  // setting the new one has to be indivisible — a unique index forbids two,
  // and a crash between two statements would leave zero.
  if (body && body.makeDefault === true) {
    if (row.is_default) return NextResponse.json({ variant: row })

    const { error } = await auth.service.rpc('set_default_variant', { p_variant_id: id })
    if (error) return NextResponse.json({ error: 'שינוי התפריט הראשי נכשל' }, { status: 500 })

    await logAudit(auth.service, auth.userId, 'variant.default',
      `הגדיר/ה את התפריט הראשי: ${rowName}`, { variantId: id, name: rowName })

    return NextResponse.json({ ok: true })
  }

  // Making a variant live is its own action and touches a different table.
  if (body && 'activate' in body && body.activate === true) {
    const temp = parseTemp(body.temp)
    if (!temp.ok) return NextResponse.json({ error: temp.error }, { status: 400 })

    if (row.is_default && temp.value.active_until) {
      // The main version is where a timer RUNS OUT to. Giving it one of its own
      // would leave the expiry with nowhere to go.
      return NextResponse.json({ error: 'אי אפשר להגביל בזמן את התפריט הראשי' }, { status: 400 })
    }

    const { error: tempError } = await auth.service
      .from('menu_variants').update(temp.value).eq('id', id)
    if (tempError) return NextResponse.json({ error: 'ההחלפה נכשלה' }, { status: 500 })

    const { error } = await activateVariant(auth.service, menu.id, id)
    if (error) return NextResponse.json({ error: 'ההחלפה נכשלה' }, { status: 500 })

    await logAudit(auth.service, auth.userId, 'variant.activate',
      temp.value.active_until
        ? `הפעיל/ה זמנית את הגרסה: ${rowName}`
        : `שינה/תה את התפריט המוצג ל: ${rowName}`,
      {
        variantId: id, name: rowName,
        ...(temp.value.active_until
          ? { until: temp.value.active_until, expireAction: temp.value.expire_action }
          : {}),
      })

    return NextResponse.json({ activeVariantId: id, temp: temp.value })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body && 'nameHe' in body) {
    const n = typeof body.nameHe === 'string' ? body.nameHe.trim() : ''
    if (!n) return NextResponse.json({ error: 'חסר שם לגרסה' }, { status: 400 })
    patch.name = { he: n.slice(0, 40) }
  }

  if (body && 'excludedUids' in body) {
    // The main version was once forced to be the FULL menu, on the reasoning
    // that hiding items there left no way back to "everything". Now that main
    // can be moved between versions, that reasoning is gone: a bar that has
    // permanently dropped six dishes should be able to promote the short menu
    // and keep it short, and the way back to everything is the editor itself.
    const next = Array.isArray(body.excludedUids)
      ? (body.excludedUids as unknown[]).filter((x): x is string => typeof x === 'string')
      : []

    // An empty menu, though, is never what anyone meant.
    const allUids = new Set(
      menu.categories.flatMap((c) => (c.items ?? []).map((i) => i.uid).filter(Boolean) as string[]),
    )
    if (allUids.size && next.filter((u) => allUids.has(u)).length >= allUids.size) {
      return NextResponse.json({ error: 'צריך להשאיר לפחות פריט אחד בתפריט' }, { status: 400 })
    }

    patch.excluded_uids = next
  }

  if (body && 'schedule' in body) {
    if (row.is_default) {
      // Scheduling the default would leave nothing to fall back to when the
      // window closes.
      return NextResponse.json({ error: 'אי אפשר לתזמן את הגרסה הרגילה' }, { status: 400 })
    }
    const s = parseSchedule(body.schedule)
    if (!s.ok) return NextResponse.json({ error: s.error }, { status: 400 })
    Object.assign(patch, s.value)
  }

  const { data, error } = await auth.service
    .from('menu_variants').update(patch).eq('id', id).select(COLS).single()

  if (error) return NextResponse.json({ error: 'עדכון נכשל' }, { status: 500 })

  const newName = (patch.name as { he?: string } | undefined)?.he ?? rowName
  await logAudit(auth.service, auth.userId, 'variant.update',
    `עדכן/ה את הגרסה: ${newName}`,
    {
      variantId: id,
      name: newName,
      ...(patch.excluded_uids ? { hiddenItems: (patch.excluded_uids as string[]).length } : {}),
      ...(patch.name ? { renamedFrom: rowName } : {}),
    })

  return NextResponse.json({ variant: data })
}

// ---- DELETE ---------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as { id?: string } | null
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const menu = await loadMenu(auth.service)
  if (!menu) return NextResponse.json({ error: 'התפריט לא נמצא' }, { status: 404 })

  const { data: row } = await auth.service
    .from('menu_variants').select('id, is_default, name').eq('id', id).eq('menu_id', menu.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })
  if (row.is_default) {
    return NextResponse.json({ error: 'אי אפשר למחוק את הגרסה הרגילה' }, { status: 400 })
  }
  const deletedName = loc(row.name as Record<string, string>, 'he') || '—'

  // Deleting the live variant must not leave the menu pointing at nothing —
  // fall back to the default before removing the row.
  if (menu.activeVariantId === id) {
    const { data: def } = await auth.service
      .from('menu_variants').select('id').eq('menu_id', menu.id).eq('is_default', true).maybeSingle()
    await auth.service.from('menus').update({ active_variant_id: def?.id ?? null }).eq('id', menu.id)
  }

  const { error } = await auth.service.from('menu_variants').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'מחיקה נכשלה' }, { status: 500 })

  await logAudit(auth.service, auth.userId, 'variant.delete',
    `מחק/ה את הגרסה: ${deletedName}`, { name: deletedName })

  return NextResponse.json({ ok: true })
}
