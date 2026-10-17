// The rules for counting visits (Vercel Web Analytics, mounted by components/SiteAnalytics.tsx).
// PURE — no React, no DOM — so scripts/check-privacy.mjs can run the real functions.
//
// What counting is, here: a page view with no cookie, nothing written to the device and no
// identifier of ours; Vercel groups a day's requests with a hash it discards after 24 hours
// (https://vercel.com/docs/analytics/privacy-policy). It is only allowed to stay that way because of
// the two rules below, and the /privacy and /cookies pages promise both:
//   1. pages that are private, personal or carry a secret in the address are never counted, and no
//      address is ever sent with its query string or fragment;
//   2. a visitor whose browser says "do not track" / Global Privacy Control is not counted.

/** Every route that is for signed-in people, carries a one-time secret or is not a page. Matches the
 *  Disallow list in app/robots.ts on purpose (the harness checks they agree). */
export const COUNTING_EXCLUDED_PREFIXES = [
  '/owner', '/staff', '/customer', '/join', '/checkin', '/login', '/auth', '/no-access', '/api',
] as const

export function isExcludedPath(pathname: string): boolean {
  // Collapse doubled slashes and ignore case, so //owner and /Owner cannot slip past a prefix test.
  const p = ('/' + pathname.replace(/\/{2,}/g, '/').replace(/^\//, '')).toLowerCase()
  return COUNTING_EXCLUDED_PREFIXES.some((x) => p === x || p.startsWith(x + '/'))
}

export interface PrivacySignals { doNotTrack?: string | null; globalPrivacyControl?: boolean }

/** True when the browser asked not to be tracked. Both signals are honoured although neither is law
 *  here: it costs nothing and it is the kind of promise a privacy page can make plainly. */
export function countingRefused(signals: PrivacySignals): boolean {
  return signals.globalPrivacyControl === true || signals.doNotTrack === '1' || signals.doNotTrack === 'yes'
}

/** The `beforeSend` hook: returns the event to send, or null to send nothing. The address is reduced to
 *  origin + path — never the query string or the fragment. */
export function sanitizeVisitEvent<E extends { url: string }>(event: E, refused: boolean): E | null {
  if (refused) return null
  let u: URL
  try { u = new URL(event.url) } catch { return null }
  if (isExcludedPath(u.pathname)) return null
  u.search = ''
  u.hash = ''
  return { ...event, url: u.toString() }
}
