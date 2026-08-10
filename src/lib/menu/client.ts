import { createClient } from '@/lib/supabase/client'
import {
  MENU_SLUG, PUBLIC_MENU_COLS, PUBLIC_VARIANT_COLS, PUBLIC_VARIANT_COLS_LEGACY,
  normalizeMenuRow, normalizeVariantRow,
  type MenuData, type PublicMenuRow, type PublicVariantRow,
} from './types'
import { HAPPY_HOUR_DEFAULT, type HappyHour } from './variants'

/** Client-side fetch (live polling while the page is open). Returns the menu
 *  UNRESOLVED — MenuView applies the variant itself so it can re-resolve as
 *  the clock crosses a schedule boundary without refetching. */
export async function fetchMenuClient(): Promise<MenuData | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('public_menus')
    .select(PUBLIC_MENU_COLS)
    .eq('slug', MENU_SLUG)
    .single()

  let menu: MenuData | null
  if (error) {
    // Pre-migration fallback — see the same note in fetch.ts.
    const { data: legacy, error: legacyError } = await supabase
      .from('public_menus')
      .select('name,badges,menu,published_at')
      .eq('slug', MENU_SLUG)
      .single()
    if (legacyError) return null
    menu = normalizeMenuRow(legacy as PublicMenuRow)
  } else {
    menu = normalizeMenuRow(data as PublicMenuRow)
  }
  if (!menu) return null

  // Typed by hand: supabase-js derives a row type from the select STRING, so
  // the full and legacy column sets come back as two different shapes that
  // won't share a variable.
  let rows: PublicVariantRow[] | null = null

  const full = await supabase
    .from('public_menu_variants')
    .select(PUBLIC_VARIANT_COLS)
    .eq('slug', MENU_SLUG)
  rows = (full.data as PublicVariantRow[] | null) ?? null

  // Pre-017 fallback — see the same note in types.ts.
  if (!rows) {
    const legacy = await supabase
      .from('public_menu_variants')
      .select(PUBLIC_VARIANT_COLS_LEGACY)
      .eq('slug', MENU_SLUG)
    rows = (legacy.data as PublicVariantRow[] | null) ?? null
  }

  if (rows) menu.variants = rows.map(normalizeVariantRow)

  return menu
}

/** Happy-hour config for the public menu. Read client-side so the discount
 *  starts and ends on the minute, rather than whenever a cache happens to
 *  expire. Fails to "no discount" — never invent a price. */
export async function fetchHappyHour(): Promise<HappyHour> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'happy_hour')
    .maybeSingle()
  if (error || !data?.value) return HAPPY_HOUR_DEFAULT
  return data.value as HappyHour
}

/** Cheap poll: just the publish timestamp, to decide whether to refetch. */
export async function fetchMenuStamp(): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase
    .from('public_menus')
    .select('published_at')
    .eq('slug', MENU_SLUG)
    .single()
  return (data as { published_at: string | null } | null)?.published_at ?? null
}
