import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { getCartActionFlags } from '@/lib/settings/server'
import {
  CALL_RATE_MAX, CALL_RATE_WINDOW_SECONDS,
  CALL_GLOBAL_RATE_MAX, CALL_GLOBAL_RATE_WINDOW_SECONDS,
  CALL_REASON_STATUS, validateCallInput, type CallRpcReason,
} from '@/lib/waiter/calls'

// A customer asking for a waiter from the menu (2026-10-13).
//
// ── WHAT THIS ROUTE IS ──────────────────────────────────────────────────
// The SECOND public write path in the app (the first is /api/feedback), and it
// is built the same way: no session, no token — a stranger at a table has
// neither — so the guard rails ARE the security. In order:
//
//   1. same-origin + application/json only
//   2. a tiny body ceiling, checked before the body is read
//   3. the DEVELOPER'S SWITCH (`waiter_call_enabled`), re-read here. It ships
//      OFF: this route exists and refuses until someone turns it on, so "wired
//      but not enabled" is a property of the endpoint, not of a hidden button.
//   4. two rate limits (per IP, and global — see lib/waiter/calls.ts)
//   5. validation that returns the exact object that is used
//   6. create_table_call() (migration 057), which re-checks the table exists
//      and is active, that a shift is open, and collapses a repeat tap
//
// The RPC is granted to the SERVICE ROLE only — never to `anon` — so this
// route (and its rate limit) is the only way in.
//
// Errors are CODES, not sentences: the menu is trilingual and the client maps a
// code through lib/waiter/calls.ts. (The generic rateLimitResponse() helper
// returns a fixed Hebrew sentence, right for its other callers, wrong here.)

const MAX_BODY_BYTES = 1024

const refuse = (code: string, status: number) => NextResponse.json({ error: code }, { status })

export async function POST(request: NextRequest) {
  try {
    // ---- 1. Same-origin only (the /api/feedback shape) --------------------
    const origin = request.headers.get('origin')
    if (origin) {
      let originHost: string | null = null
      try { originHost = new URL(origin).host } catch { originHost = null }
      const host = request.headers.get('host')
      if (!originHost || !host || originHost !== host) return refuse('bad_request', 403)
    }
    if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      return refuse('bad_request', 415)
    }

    // ---- 2. Size ----------------------------------------------------------
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refuse('bad_request', 413)

    // ---- 3. The switch (cheapest refusal first, and the one that matters
    //         while this is being tested: nothing below runs when it is off) --
    const flags = await getCartActionFlags()
    if (!flags.call) return refuse('disabled', 403)

    // ---- 4. Rate limits ---------------------------------------------------
    const ip = clientIp(request)
    if (!(await checkRateLimit(`table-call:${ip}`, CALL_RATE_MAX, CALL_RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited', 429)
    }
    if (!(await checkRateLimit('table-call:global', CALL_GLOBAL_RATE_MAX, CALL_GLOBAL_RATE_WINDOW_SECONDS))) {
      return refuse('rate_limited', 429)
    }

    // ---- 5. Validation ----------------------------------------------------
    const body = await request.json().catch(() => null)
    const parsed = validateCallInput(body)
    if (!parsed.ok) return refuse(parsed.error, 400)

    // ---- 6. The write -----------------------------------------------------
    const { data, error } = await createServiceClient().rpc('create_table_call', {
      p_table_number: parsed.value.tableNumber,
      p_kind: parsed.value.kind,
      p_cart_items: parsed.value.cartItems,
      p_cart_total: parsed.value.cartTotalAgorot,
    })
    if (error) {
      // 42883 = the function does not exist: migration 057 has not been applied.
      // Same calm answer as any other server failure — the customer is told to
      // wave a waiter over, and the log says why.
      console.error('create_table_call failed:', error.code, error.message)
      return refuse('server', 500)
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      { ok?: boolean; reason?: string | null } | null | undefined
    if (!row) return refuse('server', 500)
    if (!row.ok) {
      const reason = (row.reason ?? 'server') as CallRpcReason
      return refuse(reason, CALL_REASON_STATUS[reason] ?? 500)
    }

    // Nothing is echoed back — not the id. `duplicate` is the one fact the
    // client can use (it can say "already on its way").
    return NextResponse.json({ ok: true, duplicate: row.reason === 'duplicate' })
  } catch (err) {
    console.error('table call route error:', err)
    return refuse('server', 500)
  }
}
