import { createClient } from '@/lib/supabase/client'
import {
  MENU_SLUG, PUBLIC_MENU_COLS, normalizeMenuRow,
  type MenuData, type PublicMenuRow,
} from './types'
import { HAPPY_HOUR_DEFAULT, type HappyHour } from './variants'

/** Client-side fetch (live polling while the page is open). */
export async function fetchMenuClient(): Promise<MenuData | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('public_menus')
    .select(PUBLIC_MENU_COLS)
    .eq('slug', MENU_SLUG)
    .single()
  if (error) {
    // Pre-migration fallback — see the same note in fetch.ts.
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
