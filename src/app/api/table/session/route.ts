import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp, peekRateLimitExceeded } from '@/lib/rate-limit'
import {
  TABLE_CODE_GLOBAL_FAIL_MAX, TABLE_CODE_GLOBAL_FAIL_WINDOW_SECONDS,
  TABLE_CODE_RATE_MAX, TABLE_CODE_RATE_WINDOW_SECONDS,
  TABLE_SESSION_COOKIE,
} from '@/lib/cart/otp'
import {
  remoteErrorFromReason, sanitizeSent, validateRedeemInput, type SessionView,
} from '@/lib/cart/remote'
import { hashToken, orderingEnabled, readSessionToken, refuse, sameOriginJson, sameOriginOnly } from '@/lib/server/table-session'

// A phone connecting to a table — and recovering that connection — with the six digits a waiter read out.
// Built 2026-10-13 (migration 058, PLAN_MENU_CART.md §12), SHIPPED OFF behind `table_ordering_enabled`.
//
// ── THE THREE VERBS ─────────────────────────────────────────────────────
//   POST    {code}  redeem the digits → an httpOnly cookie + the table. The SAME digits work again from a
//                   new phone or after the cookie is cleared (recovery) until staff end the visit.
//   GET             "am I connected, to which table, and what has my visit sent?" — the page cannot read
//                   its own httpOnly cookie, so this is how the UI knows.
//   DELETE          leave: sign THIS phone out of the visit (the visit and its other phones carry on).
//
// ── POST'S GUARD RAILS, IN ORDER (the /api/table/call shape, plus the two 049 required) ────────────
//   1. same-origin + application/json, a tiny body ceiling
//   2. the developer's switch — re-read here
//   3. validation (a malformed code never reaches the database or the failure counter)
//   4. PER-IP: 10 attempts / 5 min, counted on every attempt
//   5. GLOBAL FAILURES: 50 wrong guesses / 5 min venue-wide, PEEKED before each attempt so that once it
//      is exceeded the guess is never evaluated. A per-IP limit does nothing against a spray from many
//      addresses; migration 049 made this a requirement and the endpoint must not ship without it.
//   6. redeem_table_code() — service role only; returns a status, never raises
//
// THE COOKIE is the ONE cookie this app sets for a customer. It is httpOnly (an XSS on the menu cannot
// steal the right to order to a table), Secure in production, SameSite=Lax, and expires WITH THE VISIT
// (at most 3 hours; recovery never extends it). It is declared in lib/privacy/registry.ts and this is the
// only file allowed to write it (scripts/check-privacy.mjs). It is set only AFTER a valid code — an
// ordinary visit to the menu still receives no cookie at all.

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 256
const noStore = { 'Cache-Control': 'no-store' }

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  expires,
})

// ⚠️ FOUND BY RUNNING IT (2026-10-13), CONFIRMED ON PRODUCTION. Next mirrors EVERY `response.cookies.set()` into an
// `x-middleware-set-cookie` response header. Unlike `Set-Cookie`, that header is not on the browser's list of
// forbidden response headers, so page JavaScript can read it with `response.headers.get(...)` — which would hand the
// session token to any script on the menu and quietly undo the entire point of HttpOnly (048: "an XSS on the menu
// cannot steal the right to order to a table"). Every response that sets this cookie goes through here to drop the
// mirror. scripts/check-privacy.mjs fails if a cookie is set without it.
const sealed = (response: NextResponse): NextResponse => {
  response.headers.delete('x-middleware-set-cookie')
  return response
}

export async function POST(request: NextRequest) {
  try {
    const bad = sameOriginJson(request, MAX_BODY_BYTES)
    if (bad) return bad
    if (!(await orderingEnabled())) return refuse('disabled')

    const parsed = validateRedeemInput(await request.json().catch(() => null))
    if (!parsed.ok) return refuse(parsed.error)

    const ip = clientIp(request)
    if (!(await checkRateLimit(`table-redeem:${ip}`, TABLE_CODE_RATE_MAX, TABLE_CODE_RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited')
    }
    if (await peekRateLimitExceeded('table-redeem-fail:global', TABLE_CODE_GLOBAL_FAIL_MAX, TABLE_CODE_GLOBAL_FAIL_WINDOW_SECONDS)) {
      return refuse('rate_limited')
    }

    const { data, error } = await createServiceClient().rpc('redeem_table_code', { p_code: parsed.code })
    if (error) {
      // 42883 = migration 058 (or 048) is not applied. The customer is told to wave a waiter over.
      console.error('redeem_table_code failed:', error.code, error.message)
      return refuse('server')
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      { ok?: boolean; reason?: string | null; session_token?: string; table_number?: number; expires_at?: string } | null | undefined
    if (!row) return refuse('server')

    if (!row.ok) {
      const code = remoteErrorFromReason(row.reason)
      // Only a WRONG GUESS counts toward the venue-wide counter: an expired or full visit means the digits
      // were right, which is not what a spray looks like and must not lock everyone else out.
      if (code === 'bad_code') {
        await checkRateLimit('table-redeem-fail:global', TABLE_CODE_GLOBAL_FAIL_MAX, TABLE_CODE_GLOBAL_FAIL_WINDOW_SECONDS)
      }
      return refuse(code)
    }
    if (typeof row.session_token !== 'string' || typeof row.expires_at !== 'string' || typeof row.table_number !== 'number') {
      return refuse('server')
    }

    const expires = new Date(row.expires_at)
    const response = NextResponse.json(
      { ok: true, tableNumber: row.table_number, expiresAt: row.expires_at },
      { headers: noStore },
    )
    response.cookies.set(TABLE_SESSION_COOKIE, row.session_token, cookieOptions(expires))
    return sealed(response)
  } catch (err) {
    console.error('table session POST error:', err)
    return refuse('server')
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = readSessionToken(request)
    // No (or malformed) cookie: not connected, and the database is not asked.
    if (!token || !(await orderingEnabled())) return NextResponse.json({ connected: false } satisfies SessionView, { headers: noStore })

    if (!(await checkRateLimit(`table-session-get:${clientIp(request)}`, 60, 60))) return refuse('rate_limited')

    const service = createServiceClient()
    const { data, error } = await service.rpc('table_session_lookup', { p_token: token })
    if (error) {
      console.error('table_session_lookup failed:', error.code, error.message)
      return refuse('server')
    }
    const s = (Array.isArray(data) ? data[0] : data) as
      { ok?: boolean; table_number?: number; expires_at?: string; shift_open?: boolean } | null | undefined
    if (!s?.ok || typeof s.table_number !== 'number' || typeof s.expires_at !== 'string') {
      // The session is gone (ended, expired, signed out): tell the browser to drop the dead cookie.
      const response = NextResponse.json({ connected: false } satisfies SessionView, { headers: noStore })
      response.cookies.set(TABLE_SESSION_COOKIE, '', { ...cookieOptions(new Date(0)), maxAge: 0 })
      return sealed(response)
    }

    const { data: sentRaw } = await service.rpc('table_session_submissions', { p_token: token })
    const sent = sanitizeSent(
      (Array.isArray(sentRaw) ? sentRaw : []).map((r: Record<string, unknown>) => ({
        id: r.id, status: r.status, itemCount: r.item_count, totalAgorot: r.total_agorot, createdAt: r.created_at,
      })),
    )
    const view: SessionView = {
      connected: true, tableNumber: s.table_number, expiresAt: s.expires_at, shiftOpen: s.shift_open === true, sent,
    }
    return NextResponse.json(view, { headers: noStore })
  } catch (err) {
    console.error('table session GET error:', err)
    return refuse('server')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // DELETE carries no body, so only the origin half of the guard applies.
    const foreign = sameOriginOnly(request)
    if (foreign) return foreign

    const token = readSessionToken(request)
    if (token) {
      // This phone only. The visit — and any other phone on it — carries on; only staff end a visit.
      await createServiceClient()
        .from('customer_table_sessions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('token_hash', hashToken(token))
        .is('revoked_at', null)
    }
    const response = NextResponse.json({ ok: true }, { headers: noStore })
    response.cookies.set(TABLE_SESSION_COOKIE, '', { ...cookieOptions(new Date(0)), maxAge: 0 })
    return sealed(response)
  } catch (err) {
    console.error('table session DELETE error:', err)
    return refuse('server')
  }
}
