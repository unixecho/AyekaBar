import { LOYALTY_ENABLED, LOYALTY_ENABLED_DEFAULT, SETTINGS_TAG } from './keys'

// Server-only (like lib/menu/fetch.ts): imported from server components,
// route handlers and middleware — never from a 'use client' module.

// Read a switch straight off the Supabase REST endpoint rather than through
// supabase-js, so the response lands in Next's data cache: pages stay fast
// (no per-request round-trip) and the owner API busts the tag on every flip,
// so a toggle is visible immediately. Falls back to the default if the read
// fails for any reason — a settings outage must never take the site down.
export async function readSetting<T>(key: string, fallback: T): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return fallback

  try {
    const res = await fetch(
      `${url}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}&select=value`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        next: { revalidate: 60, tags: [SETTINGS_TAG] },
      }
    )
    if (!res.ok) return fallback
    const rows = (await res.json()) as { value: unknown }[]
    if (!rows?.length) return fallback
    return rows[0].value as T
  } catch {
    return fallback
  }
}

/** Is the loyalty club live, or still "coming soon"? */
export function getLoyaltyEnabled(): Promise<boolean> {
  return readSetting<boolean>(LOYALTY_ENABLED, LOYALTY_ENABLED_DEFAULT)
}
