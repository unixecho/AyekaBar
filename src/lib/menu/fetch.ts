import { createClient } from '@/lib/supabase/server'
import {
  MENU_SLUG, PUBLIC_MENU_COLS, PUBLIC_VARIANT_COLS, PUBLIC_VARIANT_COLS_LEGACY,
  normalizeMenuRow, normalizeVariantRow, applyResolvedVariant,
  type MenuData, type PublicMenuRow, type PublicVariantRow,
} from './types'

/** Server-side fetch (first paint / SEO). */
export async function fetchMenu(): Promise<MenuData | null> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('public_menus')
    .select(PUBLIC_MENU_COLS)
    .eq('slug', MENU_SLUG)
    .single()

  // Migration 013 added the variant columns to public_menus. Until it runs,
  // selecting them errors — fall back to the original column set so the menu
  // never goes dark just because the SQL hasn't been applied.
  let menu: MenuData | null
  if (error) {
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

  // Versions + schedules (migration 015) + temp deadlines (017). Absent until
  // they run, in which case applyResolvedVariant leaves the menu exactly as
  // public_menus returned it.
  // Typed by hand — see the note in client.ts.
  let rows: PublicVariantRow[] | null = null

  const full = await supabase
    .from('public_menu_variants')
    .select(PUBLIC_VARIANT_COLS)
    .eq('slug', MENU_SLUG)
  rows = (full.data as PublicVariantRow[] | null) ?? null

  if (!rows) {
    const legacy = await supabase
      .from('public_menu_variants')
      .select(PUBLIC_VARIANT_COLS_LEGACY)
      .eq('slug', MENU_SLUG)
    rows = (legacy.data as PublicVariantRow[] | null) ?? null
  }

  if (rows) menu.variants = rows.map(normalizeVariantRow)

  return applyResolvedVariant(menu)
}
