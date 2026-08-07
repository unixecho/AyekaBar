import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/owner/guard'
import { MENU_SLUG, loc, type MenuCategory } from '@/lib/menu/types'
import { ensureUids } from '@/lib/menu/variants'
import { logAudit } from '@/lib/owner/audit'

// Owner-only CRUD for named menu variants ("רגיל" / "יום שישי") plus the
// switch for which one the public menu shows.

const COLS = 'id, name, excluded_uids, is_default, sort_order, schedule_enabled, schedule_days, schedule_start, schedule_end'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

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

/** Resolve the single menu row, minting item uids the first time anything
 *  needs to reference an item. Doing it here rather than in a SQL backfill
 *  keeps the JSONB walk in one place and makes it idempotent — variants are
 *  useless without stable item identity. */
async function loadMenu(service: SupabaseClient) {
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

export async function GET() {
  const auth = await requireOwner()
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
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { nameHe?: unknown; excludedUids?: unknown; schedule?: unknown } | null

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

  const { data, error } = await auth.service
    .from('menu_variants')
    .insert({
      menu_id: menu.id,
      name: { he: nameHe },
      excluded_uids: excluded,
      is_default: false,
      ...sched.value,
    })
    .select(COLS)
    .single()

  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })

  await logAudit(auth.service, auth.userId, 'variant.create',
    `יצר/ה גרסת תפריט: ${nameHe}`,
    { variantId: data.id, name: nameHe, hiddenItems: excluded.length })

  return NextResponse.json({ variant: data })
}

// ---- PATCH: rename / re-scope / activate ----------------------------------
export async function PATCH(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { id?: string; nameHe?: unknown; excludedUids?: unknown; activate?: unknown } | null
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const menu = await loadMenu(auth.service)
  if (!menu) return NextResponse.json({ error: 'התפריט לא נמצא' }, { status: 404 })

  const { data: row } = await auth.service
    .from('menu_variants').select('id, is_default, name').eq('id', id).eq('menu_id', menu.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })

  const rowName = loc(row.name as Record<string, string>, 'he') || '—'

  // Making a variant live is its own action and touches a different table.
  if (body && 'activate' in body && body.activate === true) {
    const { error } = await auth.service
      .from('menus').update({ active_variant_id: id }).eq('id', menu.id)
    if (error) return NextResponse.json({ error: 'ההחלפה נכשלה' }, { status: 500 })

    await logAudit(auth.service, auth.userId, 'variant.activate',
      `שינה/תה את התפריט המוצג ל: ${rowName}`,
      { variantId: id, name: rowName })

    return NextResponse.json({ activeVariantId: id })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (body && 'nameHe' in body) {
    const n = typeof body.nameHe === 'string' ? body.nameHe.trim() : ''
    if (!n) return NextResponse.json({ error: 'חסר שם לגרסה' }, { status: 400 })
    patch.name = { he: n.slice(0, 40) }
  }

  if (body && 'excludedUids' in body) {
    if (row.is_default) {
      // The default IS the full menu. Letting it hide items would leave the
      // owner with no way back to "everything".
      return NextResponse.json({ error: 'אי אפשר להסתיר פריטים בגרסה הרגילה' }, { status: 400 })
    }
    patch.excluded_uids = Array.isArray(body.excludedUids)
      ? (body.excludedUids as unknown[]).filter((x): x is string => typeof x === 'string')
      : []
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
  const auth = await requireOwner()
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
