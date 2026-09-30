import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireMenuEditor } from '@/lib/owner/guard'
import { actorIdentity, logAudit } from '@/lib/owner/audit'
import { MENU_SLUG, type MenuCategory } from '@/lib/menu/types'
import { mintUid } from '@/lib/menu/variants'
import { MENU_86 } from '@/lib/settings/keys'
import {
  MAX_ARCHIVE_ENTRIES, normalizeArchive, entryName, firstText,
  takeItem, dropItem, takeCategory, dropCategory, putItem, putCategory,
  type ArchiveEntry, type TakeFailure,
} from '@/lib/menu/archive'

// The 86 list: take an item or a whole category off the menu, keep it safe,
// bring it back with one tap.
//
// WHY THIS IS A SERVER ROUTE AND NOT A DRAFT EDIT + "PUBLISH". A dish the
// kitchen has run out of has to be off the customers' menu NOW. The draft/
// publish split exists so half-finished edits don't go live, and 86 is not an
// edit — making it wait on "save, then publish" is exactly the friction that
// left owners deleting things (or not bothering). So this applies to BOTH
// copies at once, changing nothing else in the draft: an owner mid-way through
// re-pricing the cocktails can 86 the fish without publishing the cocktails.
//
// Guarded by requireMenuEditor (OP + general manager) — the same people who can
// already delete an item from the editor.
//
// ORDER OF WRITES. Supabase cannot wrap the menu write and the list write in
// one transaction, so each operation is ordered so that a failure between the
// two can never lose a dish: on 86 the dish is saved to the list BEFORE it
// leaves the menu, and on restore it goes back on the menu BEFORE it leaves the
// list. The worst case is a dish that is briefly in both places, and a retry
// fixes that (putItem/putCategory are idempotent, and archiving replaces any
// entry for the same dish instead of adding a second).

const TOO_MANY = 'רשימת ה-86 מלאה. מחק/י מתוכה פריטים ישנים שלא צריך יותר, ונסה/י שוב.'

const FAILURE_COPY: Record<TakeFailure, string> = {
  'category-missing': 'הקטגוריה כבר לא בתפריט. רענן/י את העמוד.',
  'item-missing': 'הפריט כבר לא בתפריט — אולי כבר הורד. רענן/י את העמוד.',
  stale: 'התפריט השתנה בינתיים. רענן/י את העמוד ונסה/י שוב.',
}

// ---------------------------------------------------------------- storage

async function readEntries(service: SupabaseClient): Promise<ArchiveEntry[] | null> {
  const { data, error } = await service.from('app_settings').select('value').eq('key', MENU_86).maybeSingle()
  if (error) return null
  return normalizeArchive(data?.value)
}

async function writeEntries(service: SupabaseClient, userId: string, entries: ArchiveEntry[]): Promise<boolean> {
  const { error } = await service.from('app_settings').upsert({
    key: MENU_86,
    value: { entries },
    // Private on purpose — see MENU_86.
    is_public: false,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  }, { onConflict: 'key' })
  return !error
}

interface MenuRow {
  id: string
  draft: { categories?: MenuCategory[] } & Record<string, unknown>
  published: { categories?: MenuCategory[] } & Record<string, unknown>
  publishedAt: string | null
  draftCats: MenuCategory[]
  pubCats: MenuCategory[]
}

async function loadMenu(service: SupabaseClient): Promise<MenuRow | null> {
  const { data, error } = await service
    .from('menus')
    .select('id, draft, published, published_at')
    .eq('slug', MENU_SLUG)
    .single()
  if (error || !data) return null
  const draft = (data.draft ?? {}) as MenuRow['draft']
  const published = (data.published ?? {}) as MenuRow['published']
  return {
    id: data.id as string,
    draft,
    published,
    publishedAt: (data.published_at as string | null) ?? null,
    draftCats: draft.categories ?? [],
    pubCats: published.categories ?? [],
  }
}

/** Write the new category lists back. Only the published copy is re-stamped —
 *  and only if it actually changed — because `published_at` is what open
 *  customer pages poll to know they should refetch: an 86 that left it alone
 *  would not reach anyone already looking at the menu until they reloaded. */
async function commitMenu(
  service: SupabaseClient, userId: string, menu: MenuRow,
  draftCats: MenuCategory[], pubCats: MenuCategory[],
): Promise<{ ok: true; publishedAt: string | null } | { ok: false }> {
  const differs = (a: MenuCategory[], b: MenuCategory[]) => JSON.stringify(a) !== JSON.stringify(b)
  const draftChanged = differs(draftCats, menu.draftCats)
  const pubChanged = differs(pubCats, menu.pubCats)
  if (!draftChanged && !pubChanged) return { ok: true, publishedAt: menu.publishedAt }

  const now = new Date().toISOString()
  const nextPublished = { ...menu.published, categories: pubCats }

  const { error } = await service.from('menus').update({
    updated_at: now,
    ...(draftChanged ? { draft: { ...menu.draft, categories: draftCats } } : {}),
    ...(pubChanged ? { published: nextPublished, published_at: now } : {}),
  }).eq('id', menu.id)
  if (error) return { ok: false }

  if (pubChanged) {
    // Every change to what is live is a rollback point, same as publish_menu.
    // Best effort: the menu is already correct and a missing history row is not
    // worth failing the request over.
    await service.from('menu_versions').insert({ menu_id: menu.id, data: nextPublished, published_by: userId })
  }
  return { ok: true, publishedAt: pubChanged ? now : menu.publishedAt }
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** What every action answers with: the draft as it now stands (the editor
 *  replaces its copy with this), and the list. */
function answer(draftCats: MenuCategory[], entries: ArchiveEntry[], publishedAt: string | null) {
  return NextResponse.json({ categories: draftCats, entries, publishedAt })
}

// ---------------------------------------------------------------- GET

export async function GET() {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const entries = await readEntries(auth.service)
  if (!entries) return fail('טעינת רשימת ה-86 נכשלה', 500)
  return NextResponse.json({ entries })
}

// ---------------------------------------------------------------- POST

interface Body {
  action?: unknown
  kind?: unknown
  categoryId?: unknown
  uid?: unknown
  index?: unknown
  entryId?: unknown
}

const str = (v: unknown, max = 120): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null

export async function POST(request: NextRequest) {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res
  const { service, userId } = auth

  const body = (await request.json().catch(() => null)) as Body | null
  if (!body || typeof body.action !== 'string') return fail('בקשה לא תקינה')

  const entries = await readEntries(service)
  if (!entries) return fail('טעינת רשימת ה-86 נכשלה', 500)

  // ------------------------------------------------------------ 86 it
  if (body.action === 'archive') {
    const categoryId = str(body.categoryId)
    if (!categoryId || (body.kind !== 'item' && body.kind !== 'category')) return fail('בקשה לא תקינה')

    const menu = await loadMenu(service)
    if (!menu) return fail('התפריט לא נמצא', 404)

    const who = await actorIdentity(service, userId)
    const base = { id: crypto.randomUUID(), archivedAt: new Date().toISOString(), archivedBy: who.name ?? who.email ?? null }

    let entry: ArchiveEntry
    let draftCats: MenuCategory[]
    let pubCats: MenuCategory[]

    if (body.kind === 'item') {
      const uid = str(body.uid, 40) ?? undefined
      const index = Number.isInteger(body.index) ? (body.index as number) : undefined
      const taken = takeItem(menu.draftCats, categoryId, { uid, index }, mintUid)
      if (!taken.ok) return fail(FAILURE_COPY[taken.reason], taken.reason === 'stale' ? 409 : 404)

      entry = { ...base, kind: 'item', item: taken.item, from: taken.from }
      draftCats = taken.categories
      pubCats = dropItem(menu.pubCats, categoryId, taken.item)
    } else {
      const taken = takeCategory(menu.draftCats, categoryId)
      if (!taken.ok) return fail(FAILURE_COPY[taken.reason], 404)

      entry = { ...base, kind: 'category', category: taken.category, categoryIndex: taken.index }
      draftCats = taken.categories
      pubCats = dropCategory(menu.pubCats, categoryId)
    }

    // A retry after a half-failed attempt must replace, not add a second copy.
    const sameDish = (e: ArchiveEntry) =>
      entry.kind === 'item'
        ? e.kind === 'item' && !!e.item.uid && e.item.uid === entry.item.uid
        : e.kind === 'category' && e.category.id === entry.category.id
    const kept = entries.filter((e) => !sameDish(e))
    if (kept.length >= MAX_ARCHIVE_ENTRIES) return fail(TOO_MANY, 409)
    const next = [entry, ...kept]

    // The list first, the menu second — see the note at the top of the file.
    if (!(await writeEntries(service, userId, next))) return fail('השמירה נכשלה. שום דבר לא השתנה בתפריט.', 500)
    const committed = await commitMenu(service, userId, menu, draftCats, pubCats)
    if (!committed.ok) return fail('הפריט נשמר ברשימה אבל לא הוסר מהתפריט. נסה/י שוב.', 500)

    await logAudit(
      service, userId, 'menu.archive',
      entry.kind === 'item' ? `הוריד/ה מהתפריט (86): ${entryName(entry)}` : `הוריד/ה קטגוריה מהתפריט (86): ${entryName(entry)}`,
      entry.kind === 'item'
        ? { name: entryName(entry), category: firstText(entry.from.title) }
        : { name: entryName(entry), items: entry.category.items.length },
    )
    return answer(draftCats, next, committed.publishedAt)
  }

  // ------------------------------------------------------------ bring it back
  if (body.action === 'restore') {
    const entryId = str(body.entryId)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return fail('הפריט כבר לא ברשימה. רענן/י את העמוד.', 404)

    const menu = await loadMenu(service)
    if (!menu) return fail('התפריט לא נמצא', 404)

    // Put back in BOTH copies — "bring it back" means customers see it now.
    const put = (cats: MenuCategory[]) => (entry.kind === 'item' ? putItem(cats, entry) : putCategory(cats, entry))
    const draftCats = put(menu.draftCats)
    const pubCats = put(menu.pubCats)

    // The menu first, the list second.
    const committed = await commitMenu(service, userId, menu, draftCats, pubCats)
    if (!committed.ok) return fail('ההחזרה לתפריט נכשלה. שום דבר לא השתנה.', 500)

    const next = entries.filter((e) => e.id !== entry.id)
    if (!(await writeEntries(service, userId, next))) {
      // It IS back on the menu; only the tidy-up failed, and a repeat is harmless.
      return fail('הפריט חזר לתפריט, אבל נשאר ברשימה. אפשר ללחוץ שוב בלי חשש.', 500)
    }

    await logAudit(service, userId, 'menu.restore', `החזיר/ה לתפריט: ${entryName(entry)}`, { name: entryName(entry) })
    return answer(draftCats, next, committed.publishedAt)
  }

  // ------------------------------------------------------------ delete for good
  if (body.action === 'purge') {
    const entryId = str(body.entryId)
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return fail('הפריט כבר לא ברשימה. רענן/י את העמוד.', 404)

    const next = entries.filter((e) => e.id !== entry.id)
    if (!(await writeEntries(service, userId, next))) return fail('המחיקה נכשלה.', 500)

    await logAudit(service, userId, 'menu.purge', `מחק/ה לצמיתות מרשימת 86: ${entryName(entry)}`, { name: entryName(entry) })
    // Only the list — the menu was not touched, so there is no draft to hand
    // back, and returning one would invite the editor to swap it in over
    // edits the owner hasn't saved.
    return NextResponse.json({ entries: next })
  }

  return fail('בקשה לא תקינה')
}
