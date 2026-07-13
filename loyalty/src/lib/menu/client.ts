import { createClient } from '@/lib/supabase/client'
import { MENU_SLUG, normalizeMenuRow, type MenuData, type PublicMenuRow } from './types'

/** Client-side fetch (live polling while the page is open). */
export async function fetchMenuClient(): Promise<MenuData | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('public_menus')
    .select('name,badges,menu,published_at')
    .eq('slug', MENU_SLUG)
    .single()
  if (error) return null
  return normalizeMenuRow(data as PublicMenuRow)
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
