import {
  LOYALTY_ENABLED, LOYALTY_ENABLED_DEFAULT,
  LOYALTY_VISIBLE, LOYALTY_VISIBLE_DEFAULT,
  PORTAL_LINKS, PORTAL_LINKS_DEFAULT, type PortalLinkKey,
  PORTAL_REVIEWS,
  OMS_OVERALL_DEMO_MODE, OMS_OVERALL_DEMO_MODE_DEFAULT,
  ACCESSIBILITY_STATEMENT, ACCESSIBILITY_STATEMENT_DEFAULT, type AccessibilityStatement,
  MENU_CART_ENABLED, MENU_CART_ENABLED_DEFAULT,
  TABLE_ORDERING_ENABLED, TABLE_ORDERING_ENABLED_DEFAULT,
  WAITER_CALL_ENABLED, WAITER_CALL_ENABLED_DEFAULT,
  CUSTOMER_FEEDBACK_ENABLED, CUSTOMER_FEEDBACK_ENABLED_DEFAULT,
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

/** Does the digital menu offer its order-building cart? See
 *  MENU_CART_ENABLED for why this one defaults to ON rather than failing
 *  closed like the loyalty switch. */
export function getMenuCartEnabled(): Promise<boolean> {
  return readSetting<boolean>(MENU_CART_ENABLED, MENU_CART_ENABLED_DEFAULT)
}

/** The cart's two not-yet-built actions, read together because the sheet
 *  renders both footer buttons in one pass and a second round-trip for the
 *  second boolean would be pure waste. Both fail closed — they gate writes
 *  into live service, not a local convenience. */
export async function getCartActionFlags(): Promise<{ ordering: boolean; call: boolean }> {
  const [ordering, call] = await Promise.all([
    readSetting<boolean>(TABLE_ORDERING_ENABLED, TABLE_ORDERING_ENABLED_DEFAULT),
    readSetting<boolean>(WAITER_CALL_ENABLED, WAITER_CALL_ENABLED_DEFAULT),
  ])
  return { ordering: ordering === true, call: call === true }
}

/** Is the portal's feedback box open? Read by the portal (to render the
 *  button) and, independently, by POST /api/feedback itself — the endpoint
 *  never trusts the page that called it to have honoured the switch. See
 *  CUSTOMER_FEEDBACK_ENABLED for why this one fails open. */
export function getCustomerFeedbackEnabled(): Promise<boolean> {
  return readSetting<boolean>(CUSTOMER_FEEDBACK_ENABLED, CUSTOMER_FEEDBACK_ENABLED_DEFAULT)
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

/** The public accessibility statement — /accessibility renders only
 *  whichever of these fields actually have a value. */
export function getAccessibilityStatement(): Promise<AccessibilityStatement> {
  return readSetting<AccessibilityStatement>(ACCESSIBILITY_STATEMENT, ACCESSIBILITY_STATEMENT_DEFAULT)
}

/** Same row, plus its own last-updated timestamp — the regulations
 *  require the statement to carry a visible update date, which the plain
 *  value-only read above doesn't have. A second small request rather than
 *  widening readSetting<T>'s generic shape for every other caller. */
export async function getAccessibilityStatementUpdatedAt(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  try {
    const res = await fetch(
      `${url}/rest/v1/app_settings?key=eq.${ACCESSIBILITY_STATEMENT}&select=updated_at`,
      { headers: { apikey: anon, Authorization: `Bearer ${anon}` }, next: { revalidate: 60, tags: [SETTINGS_TAG] } }
    )
    if (!res.ok) return null
    const rows = (await res.json()) as { updated_at: string }[]
    return rows?.[0]?.updated_at ?? null
  } catch {
    return null
  }
}
