// Shape of the owner-curated review wall (app_settings key `portal_reviews`).
//
// Pure types + sanitizers, no Supabase and no server-only imports: this module
// is pulled in by both the server reader (lib/settings/server.ts) and the
// client component that renders the wall (components/ReviewWall.tsx).
//
// Why curated rather than synced from Google: the Places API returns at most
// five reviews per place and forbids storing them, and scraping the listing is
// bot-blocked. Neither can produce the 10-15 quotes this wall is built for, so
// the owner maintains the list from /owner/dashboard instead. See
// PLAN_REVIEW_WALL.md.

export type ReviewLang = 'he' | 'en' | 'ar'

export const REVIEW_LANGS: ReviewLang[] = ['he', 'en', 'ar']

export type PortalReview = {
  id: string
  /** Empty = anonymous. We never invent a name for a real person's words. */
  author: string
  /** 1-5. */
  stars: number
  /** The language the review was *written* in — drives the card's `dir`. */
  lang: ReviewLang
  /** `YYYY-MM`, or '' for unknown. Formatted per UI language at render time. */
  date: string
  text: string
  visible: boolean
}

export type PortalReviewsBlock = {
  /** Overall Google rating, e.g. 4.4 — shown in the section header. */
  rating: number
  /** Total Google review count, e.g. 38. */
  count: number
  /** Where the header and the CTA under the wall point. */
  url: string
  items: PortalReview[]
}

/** Hard cap, so a malformed save can never make the portal render 10k cards. */
export const MAX_REVIEWS = 40
export const MAX_REVIEW_LEN = 600

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** `YYYY-MM` only — anything else is dropped rather than rendered as garbage. */
const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

function normalizeReview(raw: unknown, index: number): PortalReview | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const text = typeof r.text === 'string' ? r.text.trim() : ''
  if (!text) return null // a quote wall entry with no quote is nothing

  const lang = REVIEW_LANGS.includes(r.lang as ReviewLang) ? (r.lang as ReviewLang) : 'he'
  const stars = typeof r.stars === 'number' && Number.isFinite(r.stars)
    ? clamp(Math.round(r.stars), 1, 5)
    : 5
  const date = typeof r.date === 'string' && isMonth(r.date) ? r.date : ''

  return {
    id: typeof r.id === 'string' && r.id ? r.id : `r${index}`,
    author: typeof r.author === 'string' ? r.author.trim() : '',
    stars,
    lang,
    date,
    text: text.slice(0, MAX_REVIEW_LEN),
    visible: r.visible !== false, // default-on, so a hand-written row shows up
  }
}

/**
 * Coerce whatever sits in the settings row into something safe to render.
 * Unknown fields are dropped rather than trusted — the blob is owner-written,
 * but it still round-trips through JSON and a hand-edit in the SQL editor.
 */
export function normalizeReviews(raw: unknown, fallback: PortalReviewsBlock): PortalReviewsBlock {
  if (typeof raw !== 'object' || raw === null) return fallback
  const b = raw as Record<string, unknown>

  const items = Array.isArray(b.items)
    ? b.items.slice(0, MAX_REVIEWS)
        .map((item, i) => normalizeReview(item, i))
        .filter((r): r is PortalReview => r !== null)
    : []

  // An empty list would leave a titled section with nothing under it. Better to
  // fall back to the seeded quotes than to render a hole in the portal.
  if (!items.length) return fallback

  const rating = typeof b.rating === 'number' && Number.isFinite(b.rating)
    ? clamp(b.rating, 0, 5)
    : fallback.rating
  const count = typeof b.count === 'number' && Number.isFinite(b.count)
    ? Math.max(0, Math.round(b.count))
    : fallback.count
  const url = typeof b.url === 'string' && /^https:\/\/.+/i.test(b.url.trim())
    ? b.url.trim()
    : fallback.url

  return { rating, count, url, items }
}

/** The subset the portal actually renders. */
export function visibleReviews(block: PortalReviewsBlock): PortalReview[] {
  return block.items.filter((r) => r.visible)
}
