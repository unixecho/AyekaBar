// The 86 list — pure functions, safe on both server and client.
//
// "86" is the bar word for "we're out of it": the item comes off the menu. The
// old editor only knew two ways to do that — flag it "sold out" (still on the
// menu, with a badge) or DELETE it (gone, typed back in from memory). 86 is the
// third: off the menu everywhere, kept safe on a list, one tap to bring back.
//
// WHY THE ITEMS LIVE OUTSIDE `menus.draft` / `menus.published`. Everything that
// reads the menu — the public page, the cart, the waiter app, happy hour,
// version filters, the out-of-stock signal — reads `categories`. An 86'd item
// that is simply not in `categories` is therefore invisible to all of them
// with no change to any of them, including ayeka-staff, which is a separate
// codebase. A flag on the item would need every reader taught to honour it, and
// the one that forgot would keep selling a dish the kitchen doesn't have.
//
// Every function here is non-mutating and takes the categories array as-is, so
// the route can apply the SAME operation to the draft and to the published
// copy. Exercised by scripts/check-archive.mjs.

import type { Localized, MenuCategory, MenuItem } from './types'

/** The list is a JSON blob in app_settings, read whole on every load. Generous
 *  for a bar's menu, small enough that the blob can't grow without limit — the
 *  owner clears old entries with "delete forever". */
export const MAX_ARCHIVE_ENTRIES = 300

interface EntryBase {
  /** Identity of the list entry itself — not the item's uid, which the entry
   *  has to leave untouched so variants and happy-hour rules keep pointing at it. */
  id: string
  /** ISO instant it came off the menu. */
  archivedAt: string
  /** Who did it, as a snapshot of their display name. */
  archivedBy: string | null
}

export interface ArchivedItemEntry extends EntryBase {
  kind: 'item'
  item: MenuItem
  /** Where it lived. Enough to put it back in the same spot, or to rebuild the
   *  category from scratch if that has since been 86'd or removed. */
  from: {
    categoryId: string
    icon?: string
    title: Localized
    note?: Localized
    categoryIndex: number
    itemIndex: number
  }
}

export interface ArchivedCategoryEntry extends EntryBase {
  kind: 'category'
  /** The whole category, items included, as it stood when it came off. */
  category: MenuCategory
  categoryIndex: number
}

export type ArchiveEntry = ArchivedItemEntry | ArchivedCategoryEntry

// ---------------------------------------------------------------- helpers

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(Number.isFinite(n) ? n : hi, lo), hi)

function insertAt<T>(list: T[], at: number, value: T): T[] {
  const i = clamp(at, 0, list.length)
  return [...list.slice(0, i), value, ...list.slice(i)]
}

/** First non-empty text of a Localized value — what the owner would call it. */
export function firstText(l: Localized | undefined | null): string {
  return l?.he || l?.en || l?.ar || ''
}

/** Display name of an entry, for lists and the audit trail. */
export function entryName(e: ArchiveEntry): string {
  return e.kind === 'item' ? firstText(e.item) : firstText(e.category.title)
}

/** Same dish by what the customer reads: name and price. */
function sameText(a: MenuItem, b: MenuItem): boolean {
  return (a.he ?? '') === (b.he ?? '') && String(a.price ?? '') === String(b.price ?? '')
}

/** Same item? By uid when both have one; by name and price otherwise, which is
 *  what a menu that predates uids has to go on. */
function sameItem(a: MenuItem, b: MenuItem): boolean {
  return a.uid && b.uid ? a.uid === b.uid : sameText(a, b)
}

// ---------------------------------------------------------------- taking off

/** How the editor points at an item. `uid` when it has one; otherwise its
 *  position, honoured only if the item there also has no uid — an index that
 *  now lands on an item WITH one means the menu moved under the caller. */
export interface ItemRef {
  uid?: string
  index?: number
}

export type TakeFailure = 'category-missing' | 'item-missing' | 'stale'

export type TakeItemResult =
  | {
    ok: true
    categories: MenuCategory[]
    /** The item, guaranteed a uid (minted here if it never had one). */
    item: MenuItem
    from: ArchivedItemEntry['from']
  }
  | { ok: false; reason: TakeFailure }

/** Remove one item from the DRAFT, reporting what was taken and where from. */
export function takeItem(
  categories: MenuCategory[],
  categoryId: string,
  ref: ItemRef,
  newUid: () => string,
): TakeItemResult {
  const ci = categories.findIndex((c) => c.id === categoryId)
  if (ci < 0) return { ok: false, reason: 'category-missing' }

  const cat = categories[ci]
  const items = cat.items ?? []

  let ii = -1
  if (ref.uid) {
    ii = items.findIndex((i) => i.uid === ref.uid)
  } else if (Number.isInteger(ref.index)) {
    const candidate = items[ref.index as number]
    if (!candidate) return { ok: false, reason: 'item-missing' }
    if (candidate.uid) return { ok: false, reason: 'stale' }
    ii = ref.index as number
  }
  if (ii < 0) return { ok: false, reason: 'item-missing' }

  const taken = items[ii]
  const item = taken.uid ? taken : { ...taken, uid: newUid() }

  return {
    ok: true,
    item,
    categories: categories.map((c, i) => (i === ci ? { ...c, items: items.filter((_, j) => j !== ii) } : c)),
    from: {
      categoryId: cat.id,
      ...(cat.icon ? { icon: cat.icon } : {}),
      title: cat.title,
      ...(cat.note ? { note: cat.note } : {}),
      categoryIndex: ci,
      itemIndex: ii,
    },
  }
}

/** Remove the same item from the PUBLISHED copy, wherever it stands. By uid; if
 *  the published side never got that uid (the two copies mint theirs
 *  independently until the next publish), by name and price. Removing nothing is
 *  fine — an item added since the last publish was never live. */
export function dropItem(categories: MenuCategory[], categoryId: string, item: MenuItem): MenuCategory[] {
  return categories.map((cat) => {
    if (cat.id !== categoryId) return cat
    const items = cat.items ?? []
    const byUid = item.uid ? items.filter((i) => i.uid === item.uid) : []
    if (byUid.length) return { ...cat, items: items.filter((i) => i.uid !== item.uid) }
    // Text only, NOT sameItem(): when both sides carry a uid but different
    // ones, that is precisely the case this fallback exists for.
    const at = items.findIndex((i) => sameText(i, item))
    return at < 0 ? cat : { ...cat, items: items.filter((_, j) => j !== at) }
  })
}

export type TakeCategoryResult =
  | { ok: true; categories: MenuCategory[]; category: MenuCategory; index: number }
  | { ok: false; reason: 'category-missing' }

/** Remove a whole category (and every item in it) from the draft. */
export function takeCategory(categories: MenuCategory[], categoryId: string): TakeCategoryResult {
  const index = categories.findIndex((c) => c.id === categoryId)
  if (index < 0) return { ok: false, reason: 'category-missing' }
  return {
    ok: true,
    category: categories[index],
    index,
    categories: categories.filter((_, i) => i !== index),
  }
}

export function dropCategory(categories: MenuCategory[], categoryId: string): MenuCategory[] {
  return categories.filter((c) => c.id !== categoryId)
}

// ---------------------------------------------------------------- bringing back

/** Put an item back. Idempotent: if it is already there it is not added twice. */
export function putItem(categories: MenuCategory[], entry: ArchivedItemEntry): MenuCategory[] {
  const f = entry.from
  let base = categories
  let ci = base.findIndex((c) => c.id === f.categoryId)

  // Its category has been 86'd or removed since. Rebuild it from what the entry
  // remembers rather than refusing — "bring back" should never answer with a
  // reason it can't. Restoring that category later merges into this one.
  if (ci < 0) {
    const shell: MenuCategory = {
      id: f.categoryId,
      ...(f.icon ? { icon: f.icon } : {}),
      title: f.title,
      ...(f.note ? { note: f.note } : {}),
      items: [],
    }
    ci = clamp(f.categoryIndex, 0, base.length)
    base = insertAt(base, ci, shell)
  }

  const cat = base[ci]
  const items = cat.items ?? []
  if (items.some((i) => sameItem(i, entry.item))) return base

  return base.map((c, i) => (i === ci ? { ...c, items: insertAt(items, f.itemIndex, entry.item) } : c))
}

/** Put a category back. If a category with that id is on the menu now — the
 *  owner re-created it, or one of its items was restored on its own — its items
 *  are merged in instead of the category being duplicated. Category ids are
 *  what happy-hour rules and the waiter app key on, so the id is never changed. */
export function putCategory(categories: MenuCategory[], entry: ArchivedCategoryEntry): MenuCategory[] {
  const incoming = entry.category
  const at = categories.findIndex((c) => c.id === incoming.id)

  if (at < 0) return insertAt(categories, entry.categoryIndex, incoming)

  const current = categories[at]
  const have = current.items ?? []
  const added = (incoming.items ?? []).filter((it) => !have.some((h) => sameItem(h, it)))
  return categories.map((c, i) => (i === at ? { ...c, items: [...have, ...added] } : c))
}

// ---------------------------------------------------------------- storage shape

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0

function validCategory(v: unknown): v is MenuCategory {
  return isObj(v) && isText(v.id) && isObj(v.title) && (v.items === undefined || Array.isArray(v.items))
}

/** Read the stored blob back into entries, dropping anything malformed. The row
 *  is only ever written by the 86 route from entries that passed through here,
 *  so malformed data means someone hand-edited it in the SQL editor — better a
 *  shorter list than a load that throws. Newest first. */
export function normalizeArchive(raw: unknown): ArchiveEntry[] {
  const list = isObj(raw) && Array.isArray(raw.entries) ? raw.entries : []
  const out: ArchiveEntry[] = []

  for (const e of list) {
    if (!isObj(e) || !isText(e.id) || !isText(e.archivedAt) || !Number.isFinite(Date.parse(e.archivedAt))) continue
    const base = { id: e.id, archivedAt: e.archivedAt, archivedBy: typeof e.archivedBy === 'string' ? e.archivedBy : null }

    if (e.kind === 'item' && isObj(e.item) && isObj(e.from) && isText(e.from.categoryId) && isObj(e.from.title)) {
      out.push({
        ...base, kind: 'item', item: e.item as MenuItem,
        from: {
          categoryId: e.from.categoryId,
          ...(isText(e.from.icon) ? { icon: e.from.icon } : {}),
          title: e.from.title as Localized,
          ...(isObj(e.from.note) ? { note: e.from.note as Localized } : {}),
          categoryIndex: Number.isInteger(e.from.categoryIndex) ? (e.from.categoryIndex as number) : 0,
          itemIndex: Number.isInteger(e.from.itemIndex) ? (e.from.itemIndex as number) : 0,
        },
      })
    } else if (e.kind === 'category' && validCategory(e.category)) {
      out.push({
        ...base, kind: 'category',
        category: { ...e.category, items: e.category.items ?? [] },
        categoryIndex: Number.isInteger(e.categoryIndex) ? (e.categoryIndex as number) : 0,
      })
    }
  }

  return out.sort((a, b) => Date.parse(b.archivedAt) - Date.parse(a.archivedAt))
}
