import { createClient } from '@/lib/supabase/server'
import {
  MENU_SLUG, PUBLIC_MENU_COLS, normalizeMenuRow,
  type MenuData, type PublicMenuRow,
} from './types'

/** Server-side fetch (first paint / SEO). */
export async function fetchMenu(): Promise<MenuData | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('public_menus')
    .select(PUBLIC_MENU_COLS)
    .eq('slug', MENU_SLUG)
    .single()
  // Migration 013 adds the variant columns. Until it runs, selecting them
  // errors — fall back to the pre-variant column set so the menu never goes
  // dark just because the SQL hasn't been applied yet.
  if (error) {
    const { data: legacy, error: legacyError } = await supabase
      .from('public_menus')
      .select('name,badges,menu,published_at')
      .eq('slug', MENU_SLUG)
      .single()
    if (legacyError) return null
    return normalizeMenuRow(legacy as PublicMenuRow)
  }
  return normalizeMenuRow(data as PublicMenuRow)
}
