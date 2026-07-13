// Menu domain types + i18n helpers. Mirrors the shape stored in Supabase
// (public.menus.published -> { categories: [...] }) and the legacy menu-data.js.

export type Lang = 'he' | 'en' | 'ar'
export const LANGS: Lang[] = ['he', 'en', 'ar']
export const RTL: Record<Lang, boolean> = { he: true, ar: true, en: false }

export type Localized = { he?: string; en?: string; ar?: string }

export interface MenuItem extends Localized {
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
}

// This deployment shows one bar. The menu lives in public.menus (by slug); the
// published-only public projection is the public_menus view.
export const MENU_SLUG = 'ayeka-bar'

export interface PublicMenuRow {
  name: MenuData['name'] | null
  badges: MenuData['badges'] | null
  menu: { categories?: MenuData['categories'] } | null
  published_at: string | null
}

export function normalizeMenuRow(row: PublicMenuRow | null): MenuData | null {
  if (!row) return null
  return {
    name: row.name ?? {},
    badges: row.badges ?? {},
    categories: row.menu?.categories ?? [],
    publishedAt: row.published_at ?? null,
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
} as const
