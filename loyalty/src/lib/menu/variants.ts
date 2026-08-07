// Menu variants + happy hour — pure functions, safe on both server and client.
//
// A VARIANT is a named subset of the one menu: "רגיל" shows everything,
// "יום שישי" hides the items the kitchen isn't doing. Variants store only what
// they EXCLUDE, so an item added to the menu next month appears everywhere by
// default and never silently goes missing from a variant nobody re-checked.
//
// HAPPY HOUR is separate and orthogonal: a time window plus percentage rules.
// It changes prices, not which items exist, so the two never fight.

import type { MenuCategory, MenuItem } from './types'

// ---------------------------------------------------------------- identity

const UID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function mintUid(): string {
  let s = ''
  for (let i = 0; i < 10; i++) s += UID_ALPHABET[Math.floor(Math.random() * UID_ALPHABET.length)]
  return s
}

/**
 * Give every item a `uid`, leaving existing ones untouched. Idempotent, and
 * deliberately non-destructive: it only ever ADDS a field, so running it
 * against a menu that already has uids is a no-op and old clients that don't
 * know about uids keep working.
 *
 * Returns the categories plus whether anything changed, so a caller can skip
 * a pointless write.
 */
export function ensureUids(categories: MenuCategory[]): {
  categories: MenuCategory[]
  changed: boolean
} {
  let changed = false
  const seen = new Set<string>()

  const next = categories.map((cat) => ({
    ...cat,
    items: (cat.items ?? []).map((item) => {
      // Regenerate on collision too — a duplicated item (the owner copying a
      // row) would otherwise share identity with its source, and excluding one
      // would silently exclude both.
      if (item.uid && !seen.has(item.uid)) {
        seen.add(item.uid)
        return item
      }
      let uid = mintUid()
      while (seen.has(uid)) uid = mintUid()
      seen.add(uid)
      changed = true
      return { ...item, uid }
    }),
  }))

  return { categories: next, changed }
}

// ---------------------------------------------------------------- variants

export interface MenuVariant {
  id: string
  name: { he?: string; en?: string; ar?: string }
  /** Item uids this variant hides. Empty = the full menu. */
  excludedUids: string[]
  isDefault: boolean
  sortOrder: number | null
}

/**
 * Drop excluded items, then drop any category left empty — a heading with
 * nothing under it reads as a loading bug, not a short menu.
 */
export function applyVariant(
  categories: MenuCategory[],
  excludedUids: string[] | null | undefined,
): MenuCategory[] {
  if (!excludedUids?.length) return categories
  const hidden = new Set(excludedUids)

  return categories
    .map((cat) => ({ ...cat, items: (cat.items ?? []).filter((i) => !i.uid || !hidden.has(i.uid)) }))
    .filter((cat) => cat.items.length > 0)
}

// ------------------------------------------------------------- happy hour

export interface HappyHourRule {
  /** A whole category (by category id) or a single item (by item uid). */
  scope: 'category' | 'item'
  id: string
  /** Percentage OFF, 1–90. */
  percent: number
}

export interface HappyHour {
  enabled: boolean
  /** "HH:MM", bar-local. `end` <= `start` means the window crosses midnight. */
  start: string
  end: string
  rules: HappyHourRule[]
}

export const HAPPY_HOUR_DEFAULT: HappyHour = {
  enabled: false,
  start: '11:00',
  end: '23:59',
  rules: [],
}

/** The bar is in Harish. A visitor's phone may be on any timezone, and using
 *  it would show tourists the wrong prices — so always ask what time it is
 *  *at the bar*, never what time it is on the device. */
export function barTimeMinutes(now: Date = new Date()): number {
  const hhmm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now)
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

/** Is the window open right now? Handles "11:00 until closing at 02:00", which
 *  wraps past midnight — the common case for a bar. */
export function isHappyHourActive(hh: HappyHour | null | undefined, now?: Date): boolean {
  if (!hh?.enabled || !hh.rules.length) return false
  const start = toMinutes(hh.start)
  const end = toMinutes(hh.end)
  const t = barTimeMinutes(now)
  return end > start ? t >= start && t < end : t >= start || t < end
}

export interface DiscountedItem extends MenuItem {
  /** Set only while a discount applies — the original, for strike-through. */
  originalPrice?: number | string | null
  discountPercent?: number
}

/**
 * Apply happy-hour percentages. Item rules beat category rules, so the owner
 * can discount a whole category and then set one item differently.
 *
 * Range prices ("52/208" — a glass/jug pair) are discounted part-by-part;
 * treating them as a number would produce NaN and wipe the price off the menu.
 * Anything non-numeric is left exactly as it was.
 */
export function applyHappyHour(
  categories: MenuCategory[],
  hh: HappyHour | null | undefined,
  now?: Date,
): MenuCategory[] {
  if (!isHappyHourActive(hh, now)) return categories

  const byCategory = new Map<string, number>()
  const byItem = new Map<string, number>()
  for (const r of hh!.rules) {
    if (r.scope === 'category') byCategory.set(r.id, r.percent)
    else byItem.set(r.id, r.percent)
  }

  return categories.map((cat) => {
    const catPercent = byCategory.get(cat.id)
    return {
      ...cat,
      items: (cat.items ?? []).map((item) => {
        const percent = (item.uid && byItem.get(item.uid)) ?? catPercent
        if (!percent) return item
        const discounted = discountPrice(item.price, percent)
        if (discounted === null) return item
        return {
          ...item,
          price: discounted,
          originalPrice: item.price,
          discountPercent: percent,
        } as DiscountedItem
      }),
    }
  })
}

/** Returns null when the price can't be discounted meaningfully. */
function discountPrice(
  price: number | string | null | undefined,
  percent: number,
): number | string | null {
  if (price === null || price === undefined || price === '') return null
  const factor = (100 - percent) / 100

  if (typeof price === 'number') return Math.round(price * factor)

  // "52/208" or "52 / 208" — discount each side, keep the separator.
  if (price.includes('/')) {
    const parts = price.split('/')
    const out = parts.map((p) => {
      const n = Number(p.trim())
      return Number.isFinite(n) ? String(Math.round(n * factor)) : p.trim()
    })
    return out.join('/')
  }

  const n = Number(price)
  return Number.isFinite(n) ? String(Math.round(n * factor)) : null
}
