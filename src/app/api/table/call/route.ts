import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { getCartActionFlags } from '@/lib/settings/server'
import { notifyStaffOfCall } from '@/lib/push/orders'
import { afterResponse } from '@/lib/server/after'
import { readSessionToken } from '@/lib/server/table-session'
import {
  CALL_RATE_MAX, CALL_RATE_WINDOW_SECONDS,
  CALL_GLOBAL_RATE_MAX, CALL_GLOBAL_RATE_WINDOW_SECONDS,
  CALL_REASON_STATUS, validateCallInput, validateSessionCallInput, type CallKind, type CallRpcReason,
} from '@/lib/waiter/calls'

// A customer asking for a waiter from the menu (2026-10-13; connected phones 2026-10-15).
//
// ── TWO WAYS IN (2026-10-15) ────────────────────────────────────────────
//   • A phone CONNECTED to its table (the httpOnly cookie a waiter's code earned) is not asked which table: the
//     table — and the waiter who looks after it — come from the SESSION (create_table_call_for_session, migration
//     061); nothing in the body can name one. The answer says who is coming.
//   • A phone that is NOT connected types the number printed on the table (057's original path, unchanged).
//   A cookie the database no longer accepts (the visit ended) falls through to the typed path when the body carries a
//   number, and otherwise says so — it is never a way to call a table the phone is not at.
// Either way the TABLE'S WAITER is pushed first and, if nobody takes the call within 90 seconds, the rest of the
// shift is too (lib/push/orders.ts).
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

// The push runs after the response and may sleep through the escalation window (see /api/table/order).
export const maxDuration = 150

const MAX_BODY_BYTES = 1024

type CallRow = {
  ok?: boolean; reason?: string | null; call_id?: string; table_id?: string | null; table_number?: number | null; holder_id?: string | null
}
const firstRow = (data: unknown): CallRow | null => (Array.isArray(data) ? data[0] : data) as CallRow | null | undefined ?? null

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

    // ---- 5. The body, and which way in ------------------------------------
    const body = await request.json().catch(() => null)
    const service = createServiceClient()
    const token = readSessionToken(request)

    let row: CallRow | null = null
    let kind: CallKind = 'waiter'
    let cartItems = 0
    let waiterName: string | null = null

    // ---- 6a. A CONNECTED phone: the table is the session's -----------------
    if (token) {
      const parsed = validateSessionCallInput(body)
      if (!parsed.ok) return refuse(parsed.error, 400)
      const { data, error } = await service.rpc('create_table_call_for_session', {
        p_token: token,
        p_kind: parsed.value.kind,
        p_cart_items: parsed.value.cartItems,
        p_cart_total: parsed.value.cartTotalAgorot,
      })
      // 42883 (Postgres) / PGRST202 (PostgREST: "not in the schema cache") = migration 061 is not applied yet: the typed
      // path below still works exactly as before.
      if (error && error.code !== '42883' && error.code !== 'PGRST202') {
        console.error('create_table_call_for_session failed:', error.code, error.message)
        return refuse('server', 500)
      }
      const answered = error ? null : firstRow(data)
      if (answered?.ok) {
        row = answered
        kind = parsed.value.kind
        cartItems = parsed.value.cartItems
        const { data: name } = await service.rpc('table_session_waiter', { p_token: token })
        waiterName = typeof name === 'string' && name.trim() ? name.trim() : null
      } else if (answered && !['no_session', 'expired', 'ended'].includes(answered.reason ?? '')) {
        // A real refusal (no shift, a bad kind): say so.
        const reason = (answered.reason ?? 'server') as CallRpcReason
        return refuse(reason, CALL_REASON_STATUS[reason] ?? 500)
      }
      // else: the session is gone (or 061 is not there) → try the typed number below.
    }

    // ---- 6b. A phone that is NOT connected types the table's number ---------
    if (!row) {
      const parsed = validateCallInput(body)
      if (!parsed.ok) {
        // A connected-looking phone whose session ended and typed nothing: tell it plainly, not "bad table".
        return refuse(token ? 'no_session' : parsed.error, token ? 401 : 400)
      }
      const { data, error } = await service.rpc('create_table_call', {
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
      const answered = firstRow(data)
      if (!answered) return refuse('server', 500)
      if (!answered.ok) {
        const reason = (answered.reason ?? 'server') as CallRpcReason
        return refuse(reason, CALL_REASON_STATUS[reason] ?? 500)
      }
      row = { ...answered, table_number: answered.table_number ?? parsed.value.tableNumber }
      kind = parsed.value.kind
      cartItems = parsed.value.cartItems
    }

    const duplicate = row.reason === 'duplicate'
    // A repeat tap is the SAME call (it is already on its way): nobody is paged twice.
    if (!duplicate && typeof row.call_id === 'string') {
      const alert = {
        callId: row.call_id, kind, cartItems,
        tableNumber: row.table_number ?? null, tableId: row.table_id ?? null,
      }
      afterResponse(() => notifyStaffOfCall(alert))
    }

    // Nothing else is echoed back — not the id. `duplicate` lets the client say "already on its way"; the table number
    // and the waiter's FIRST name are what a connected customer is shown ("your waiter: Dana").
    return NextResponse.json({ ok: true, duplicate, tableNumber: row.table_number ?? null, waiterName })
  } catch (err) {
    console.error('table call route error:', err)
    return refuse('server', 500)
  }
}
