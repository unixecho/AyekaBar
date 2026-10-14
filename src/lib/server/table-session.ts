// Shared guard rails for the two customer-facing remote-ordering routes
// (/api/table/session and /api/table/order). Server-only.
//
// These are the SAME rails /api/feedback and /api/table/call stand behind, because this is the third
// public write path in the app and the first that carries a credential: same-origin + JSON only, a body
// ceiling read from the header, the developer's switch, rate limits, then validation. Errors are CODES
// (lib/cart/remote.ts) — the menu is trilingual and the client chooses the words.
//
// Reading the session cookie lives here; WRITING it does not. Exactly one file sets that cookie
// (app/api/table/session/route.ts), and scripts/check-privacy.mjs fails if a second one appears.

import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { TABLE_SESSION_COOKIE } from '@/lib/cart/otp'
import { REMOTE_ERROR_STATUS, isValidSessionToken, type RemoteError } from '@/lib/cart/remote'
import { getCartActionFlags } from '@/lib/settings/server'

/** An error response. Nothing about WHY a session was refused leaks beyond the code. */
export const refuse = (code: RemoteError) =>
  NextResponse.json({ error: code }, { status: REMOTE_ERROR_STATUS[code], headers: { 'Cache-Control': 'no-store' } })

/** Same-origin only (for verbs with no body, like DELETE). A request that sends an Origin header must
 *  send OUR host; one that sends none is not a browser cross-site request. Returns a response or null. */
export function sameOriginOnly(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin')
  if (origin) {
    let originHost: string | null = null
    try { originHost = new URL(origin).host } catch { originHost = null }
    const host = request.headers.get('host')
    if (!originHost || !host || originHost !== host) return refuse('bad_request')
  }
  return null
}

/** Same-origin, JSON, and not enormous. Returns a response to send, or null to carry on.
 *  The size is read from the header BEFORE the body is, so an oversized one is never buffered. */
export function sameOriginJson(request: NextRequest, maxBytes: number): NextResponse | null {
  const foreign = sameOriginOnly(request)
  if (foreign) return foreign
  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) return refuse('bad_request')
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return refuse('bad_request')
  return null
}

/** The developer's switch, re-read on the server — the route never trusts that the page honoured it.
 *  Ships OFF (`table_ordering_enabled`), so "built but not enabled" is a property of the endpoint. */
export async function orderingEnabled(): Promise<boolean> {
  return (await getCartActionFlags()).ordering
}

/** The phone's session token from its cookie, or null if absent or malformed (never asks the database
 *  about something that cannot be a token). */
export function readSessionToken(request: NextRequest): string | null {
  const value = request.cookies.get(TABLE_SESSION_COOKIE)?.value
  return isValidSessionToken(value) ? value : null
}

/** SHA-256 hex of a token — what the database stores (058: `encode(digest(token,'sha256'),'hex')`). */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
