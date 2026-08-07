// Menu domain types + i18n helpers. Mirrors the shape stored in Supabase
// (public.menus.published -> { categories: [...] }) and the legacy menu-data.js.

import { applyVariant } from './variants'

export type Lang = 'he' | 'en' | 'ar'
export const LANGS: Lang[] = ['he', 'en', 'ar']
export const RTL: Record<Lang, boolean> = { he: true, ar: true, en: false }

export type Localized = { he?: string; en?: string; ar?: string }

export interface MenuItem extends Localized {
  /** Stable identity, minted by ensureUids(). Categories always had an `id`;
   *  items were addressed by array position, which changes on every reorder —
   *  so nothing could reference an item until this existed. Menu variants and
   *  happy-hour rules both depend on it. */
  uid?: string
  price?: number | string | null
  note?: Localized
  badges?: string[]
  badge?: string
  image?: string
  available?: boolean
}

export interface MenuCategory {
  id: string
  icon?: string
  title: Localized
  note?: Localized
  items: MenuItem[]
}

export interface MenuData {
  name: Localized
  badges: Record<string, Localized>
  categories: MenuCategory[]
  publishedAt: string | null
  /** Name of the variant on show, e.g. "יום שישי". Null on the default. */
  variantName?: Localized | null
}

// This deployment shows one bar. The menu lives in public.menus (by slug); the
// published-only public projection is the public_menus view.
export const MENU_SLUG = 'ayeka-bar'

export interface PublicMenuRow {
  name: MenuData['name'] | null
  badges: MenuData['badges'] | null
  menu: { categories?: MenuData['categories'] } | null
  published_at: string | null
  /** Active variant (migration 013). Null on a database that hasn't run it. */
  variant_id?: string | null
  variant_name?: Localized | null
  variant_excluded_uids?: string[] | null
}

/** Columns the public menu reads. Kept in one place so the server and client
 *  fetchers can never drift apart. */
export const PUBLIC_MENU_COLS =
  'name,badges,menu,published_at,variant_id,variant_name,variant_excluded_uids'

export function normalizeMenuRow(row: PublicMenuRow | null): MenuData | null {
  if (!row) return null
  return {
    name: row.name ?? {},
    badges: row.badges ?? {},
    // Variant filtering happens here so every reader — server first paint and
    // client poll alike — sees the same menu. `applyVariant` no-ops when the
    // list is empty, which is also the pre-migration shape.
    categories: applyVariant(row.menu?.categories ?? [], row.variant_excluded_uids),
    publishedAt: row.published_at ?? null,
    variantName: row.variant_name ?? null,
  }
}

/** Localized read with fallback chain he → en → ar. */
export function loc(obj: Localized | undefined | null, lang: Lang): string {
  if (!obj) return ''
  return obj[lang] || obj.he || obj.en || obj.ar || ''
}

/** Prices are numbers, range strings ("52/208"), or null (not set). */
export function fmtPrice(p: number | string | null | undefined): string {
  if (p === null || p === undefined || p === '') return ''
  return typeof p === 'string' ? p.replace('/', ' / ') : String(p)
}

export const MENU_UI = {
  back:    { he: 'חזרה', en: 'Back', ar: 'رجوع' },
  sold:    { he: 'אזל', en: 'Sold out', ar: 'نفد' },
  items:   { he: 'פריטים', en: 'items', ar: 'عناصر' },
  langName:{ he: 'עברית', en: 'English', ar: 'العربية' },
  footer:  { he: 'המחירים בשקלים חדשים (₪)', en: 'Prices in NIS (₪)', ar: 'الأسعار بالشيكل الجديد (₪)' },
  unavailable: {
    he: 'התפריט אינו זמין כרגע. נסו שוב עוד רגע.',
    en: 'The menu isn’t available right now. Try again in a moment.',
    ar: 'القائمة غير متوفرة حالياً. حاول مرة أخرى بعد قليل.',
  },
  menuWord: { he: 'תפריט', en: 'Menu', ar: 'القائمة' },
  // The owner asked for the English name — locals use it as-is.
  happyHour: { he: 'Happy Hour', en: 'Happy Hour', ar: 'Happy Hour' },
  happyHourSub: {
    he: 'מחירים מיוחדים על פריטים נבחרים',
    en: 'Special prices on selected items',
    ar: 'أسعار خاصة على أصناف مختارة',
  },
  // A cheaper price with no explanation reads as a mistake — say why, and
  // until when, so nobody argues about it at the bar.
  happyHourUntil: { he: 'עד', en: 'until', ar: 'حتى' },
  wasPrice: { he: 'מחיר רגיל', en: 'Regular price', ar: 'السعر العادي' },
} as const
