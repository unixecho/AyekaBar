import {
  LOYALTY_ENABLED, LOYALTY_ENABLED_DEFAULT,
  LOYALTY_VISIBLE, LOYALTY_VISIBLE_DEFAULT,
  PORTAL_LINKS, PORTAL_LINKS_DEFAULT, type PortalLinkKey,
  PORTAL_REVIEWS,
  OMS_OVERALL_DEMO_MODE, OMS_OVERALL_DEMO_MODE_DEFAULT,
  SETTINGS_TAG,
} from './keys'
import { PORTAL_REVIEWS_DEFAULT } from '@/lib/reviews/seed'
import { normalizeReviews, type PortalReviewsBlock } from '@/lib/reviews/types'

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

/** Does the loyalty entry show on the portal at all? Independent of access. */
export function getLoyaltyVisible(): Promise<boolean> {
  return readSetting<boolean>(LOYALTY_VISIBLE, LOYALTY_VISIBLE_DEFAULT)
}

/** Is the Overall view's demo mode on? See OMS_OVERALL_DEMO_MODE — false
 *  means the deck observes a live service and cannot write. */
export function getOverallDemoMode(): Promise<boolean> {
  return readSetting<boolean>(OMS_OVERALL_DEMO_MODE, OMS_OVERALL_DEMO_MODE_DEFAULT)
}

/** The portal's external link destinations (Instagram, Facebook, review, navigate). */
export async function getPortalLinks(): Promise<Record<PortalLinkKey, string>> {
  const stored = await readSetting<Partial<Record<PortalLinkKey, string>>>(PORTAL_LINKS, {})
  // Merge over the defaults so a partially-saved row (or a key added after
  // the owner last saved) never leaves a button pointing nowhere. This is what
  // makes adding a link key — `facebook`, say — safe before its migration runs.
  return { ...PORTAL_LINKS_DEFAULT, ...stored }
}

/** The owner-curated quotes behind the portal's review wall. */
export async function getPortalReviews(): Promise<PortalReviewsBlock> {
  const stored = await readSetting<unknown>(PORTAL_REVIEWS, null)
  // Sanitize rather than trust: the row is owner-written but hand-editable in
  // the SQL editor, and an empty/broken blob falls back to the seeded quotes
  // instead of leaving a titled section with nothing under it.
  return normalizeReviews(stored, PORTAL_REVIEWS_DEFAULT)
}
