// The one rule every state-changing /api request passes before any route code runs. PURE, called from
// src/middleware.ts and tested by scripts/check-security.mjs.
//
// ── SAME-ORIGIN ─────────────────────────────────────────────────────────
// The session cookie is SameSite=Lax, which stops another SITE, but staff.ayeka.bar counts as the same site as
// www.ayeka.bar. So a script running on any subdomain could otherwise POST to an owner route with the owner's cookie.
// A browser always sends Origin on these methods, so a foreign one is refused here. A missing Origin is not a browser
// cross-site request and still has to pass the route's own session check.
//
// ── BODY SIZE ───────────────────────────────────────────────────────────
// Routes read their limit from Content-Length, and a request with no such header (chunked, or plain HTTP/2) used to
// read as 0 and skip the limit. A body-bearing method must now declare its size, and that size has a ceiling.
// Route-specific limits still apply below it.

export const API_BODY_CEILING_BYTES = 256 * 1024

/** Upload routes, which carry their own file-size checks. */
export const API_UPLOAD_ROUTES = ['/api/owner/payslips', '/api/zreport']

/** Called by the POS from staff.ayeka.bar. It carries a Bearer token instead of a cookie and has its own origin list. */
export const API_CROSS_ORIGIN_ROUTES = ['/api/push/staff-event']

/** POST routes that take no body, so the browser may send no Content-Length at all. */
export const API_BODYLESS_ROUTES = ['/api/auth/signout', '/api/loyalty/generate-qr']

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

export interface ApiRequestFacts {
  method: string
  pathname: string
  origin: string | null
  host: string | null
  contentLength: string | null
}

export type ApiRefusal = { status: 400 | 403 | 411 | 413; error: string }

export function apiRefusal(req: ApiRequestFacts): ApiRefusal | null {
  const { pathname } = req
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return null
  const method = req.method.toUpperCase()
  if (SAFE_METHODS.has(method)) return null

  if (req.origin !== null && !API_CROSS_ORIGIN_ROUTES.includes(pathname)) {
    let originHost: string | null = null
    try { originHost = new URL(req.origin).host } catch { originHost = null }
    if (!originHost || !req.host || originHost.toLowerCase() !== req.host.toLowerCase()) {
      return { status: 403, error: 'forbidden' }
    }
  }

  if (req.contentLength === null) {
    if (BODY_METHODS.has(method) && !API_BODYLESS_ROUTES.includes(pathname)) return { status: 411, error: 'length_required' }
    return null
  }
  if (!/^\d+$/.test(req.contentLength)) return { status: 400, error: 'bad_request' }
  if (Number(req.contentLength) > API_BODY_CEILING_BYTES && !API_UPLOAD_ROUTES.includes(pathname)) {
    return { status: 413, error: 'too_big' }
  }
  return null
}
