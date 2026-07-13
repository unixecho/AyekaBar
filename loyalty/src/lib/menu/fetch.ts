import { createClient } from '@/lib/supabase/server'
import { MENU_SLUG, normalizeMenuRow, type MenuData, type PublicMenuRow } from './types'

/** Server-side fetch (first paint / SEO). */
export async function fetchMenu(): Promise<MenuData | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('public_menus')
    .select('name,badges,menu,published_at')
    .eq('slug', MENU_SLUG)
    .single()
  if (error) return null
  return normalizeMenuRow(data as PublicMenuRow)
}
