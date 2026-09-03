// Menu domain types + i18n helpers. Mirrors the shape stored in Supabase
// (public.menus.published -> { categories: [...] }) and the legacy menu-data.js.

import { applyVariant, resolveVariant, type MenuVariant } from './variants'

export type Lang = 'he' | 'en' | 'ar'
export const LANGS: Lang[] = ['he', 'en', 'ar']
export const RTL: Record<Lang, boolean> = { he: true, ar: true, en: false }

export type Localized = { he?: string; en?: string; ar?: string }

export interface MenuOptionChoice extends Localized {
  /** Stable identity — what waiter_order_items.selected_options snapshots as
   *  choiceId (029_waiter_item_options.sql's own comment). Never the label,
   *  which the owner can edit at any time. */
  id: string
}

export interface MenuOptionGroup {
  /** Snapshotted as selected_options[].groupId — same stability rule. */
  id: string
  label: Localized
  choices: MenuOptionChoice[]
}

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
  /** Choices a price split can't express — same-priced named options like
   *  hookah flavor (item E, 2026-08-15) or a pasta sauce. Additive to the
   *  price-variant mechanism, not a replacement (029's own header comment).
   *  Absent/empty = no options, the common case. Owner-editable in
   *  MenuEditor's ItemEditor; read (display-only, no selection) on the
   *  public menu so customers can see what's actually available; read
   *  again in ayeka-staff's add-item flow, where a choice per group is
   *  required before the line can be registered and gets snapshotted into
   *  waiter_order_items.selected_options. */
  options?: MenuOptionGroup[]
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
  /** Every version + schedule, so the client can re-resolve as time passes. */
  variants: MenuVariant[]
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
    // Raw, unfiltered. Which version applies depends on the time of day now
    // that versions can be scheduled, so filtering happens in
    // applyResolvedVariant() where the clock is available — and gets redone
    // client-side each minute.
    categories: row.menu?.categories ?? [],
    publishedAt: row.published_at ?? null,
    // Pre-migration fallback: the joined active variant from public_menus.
    variantName: row.variant_name ?? null,
    variants: [],
  }
}

/** Row shape of public.public_menu_variants (migration 015). */
export interface PublicVariantRow {
  id: string
  name: Localized | null
  excluded_uids: string[] | null
  is_default: boolean
  sort_order: number | null
  schedule_enabled: boolean | null
  schedule_days: number[] | null
  schedule_start: string | null
  schedule_end: string | null
  is_active: boolean | null
  /** Temporary deadline (migration 017). Absent until it runs. */
  active_until?: string | null
}

const VARIANT_COLS_BASE =
  'id,name,excluded_uids,is_default,sort_order,schedule_enabled,schedule_days,schedule_start,schedule_end,is_active'

export const PUBLIC_VARIANT_COLS = `${VARIANT_COLS_BASE},active_until`
/** Migration 017 adds active_until to the view. Selecting a column the view
 *  doesn't have yet errors the WHOLE query — which would drop every version and
 *  silently un-filter the menu, not just lose the timer. So there's a rung to
 *  fall back to, same as public_menus has. */
export const PUBLIC_VARIANT_COLS_LEGACY = VARIANT_COLS_BASE

export function normalizeVariantRow(r: PublicVariantRow): MenuVariant {
  return {
    id: r.id,
    name: r.name ?? {},
    excludedUids: r.excluded_uids ?? [],
    isDefault: !!r.is_default,
    sortOrder: r.sort_order,
    scheduleEnabled: !!r.schedule_enabled,
    scheduleDays: r.schedule_days ?? [],
    scheduleStart: r.schedule_start,
    scheduleEnd: r.schedule_end,
    isActive: !!r.is_active,
    activeUntil: r.active_until ?? null,
  }
}

/**
 * Resolve which version applies at `now` and filter the menu to it. Pure, so
 * the server first paint and the client's per-minute re-check agree.
 */
export function applyResolvedVariant(menu: MenuData, now?: Date): MenuData {
  if (!menu.variants.length) {
    // No variant table yet (pre-015) — fall back to whatever public_menus
    // joined in, which is the manually-active version.
    return menu
  }
  const chosen = resolveVariant(menu.variants, now)
  return {
    ...menu,
    categories: applyVariant(menu.categories, chosen?.excludedUids),
    variantName: chosen?.name ?? null,
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
  // A11y backlog A14 (WCAG 2.2 3.2.6 Consistent Help) — matches Portal.tsx's
  // own `accessibility` string exactly, so the same word appears in the same
  // footer position on every customer-facing page.
  accessibility: { he: 'הצהרת נגישות', en: 'Accessibility statement', ar: 'بيان إمكانية الوصول' },
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
