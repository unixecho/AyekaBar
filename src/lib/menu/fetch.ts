import { createClient } from '@/lib/supabase/server'
import {
  MENU_SLUG, PUBLIC_MENU_COLS, PUBLIC_VARIANT_COLS,
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

  // Versions + schedules (migration 015). Absent until it runs, in which case
  // applyResolvedVariant leaves the menu exactly as public_menus returned it.
  const { data: rows } = await supabase
    .from('public_menu_variants')
    .select(PUBLIC_VARIANT_COLS)
    .eq('slug', MENU_SLUG)

  if (rows) menu.variants = (rows as PublicVariantRow[]).map(normalizeVariantRow)

  return applyResolvedVariant(menu)
}
