import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { validateSubmission } from '@/lib/cart/submission'
import { remoteErrorFromReason } from '@/lib/cart/remote'
import { notifyStaffOfSubmission } from '@/lib/push/orders'
import { afterResponse } from '@/lib/server/after'
import { orderingEnabled, readSessionToken, refuse, sameOriginJson } from '@/lib/server/table-session'

// A connected phone sends its cart to the waiters. Built 2026-10-13 (migration 058,
// PLAN_MENU_CART.md §12), SHIPPED OFF behind `table_ordering_enabled`.
//
// ── A SUBMISSION IS A REQUEST, NOT AN ORDER ─────────────────────────────
// What this route creates is a PENDING row that a waiter reviews and consciously imports in the POS, which
// re-prices every line from the live menu (lib/cart/submission.ts says why: a double-tapped "+" must never
// become a kitchen ticket). Nothing is fired at the bar or kitchen from here.
//
// ── GUARD RAILS, IN ORDER ───────────────────────────────────────────────
//   1. same-origin + application/json, a body ceiling read from the header (64 KB, MAX_LINES lines is far less)
//   2. the developer's switch — re-read here
//   3. a session cookie. It proves the phone was given a code by staff for a table; the table is whatever
//      the SESSION says — never anything in the body, so a customer cannot order to a table they are not at
//   4. per-IP and global rate limits
//   5. validateSubmission(): the independent server-side validation, whose RETURN VALUE is what is stored
//      (never the caller's object with a few fields checked), with the total recomputed
//   6. create_cart_submission() (service role only): re-checks the session is live, a shift is open, caps a
//      visit at 3 pending requests and one per 20 seconds, refuses out-of-range counts
//   7. AFTER the response: push to the staff on shift (lib/push/orders.ts) — best-effort, never blocks a send
//
// Errors are CODES (lib/cart/remote.ts); the client chooses the words in the customer's language.

export const dynamic = 'force-dynamic'
// The push runs after the response and may wait out the escalation window (lib/push/orders.ts, ESCALATION_SECONDS)
// before it checks whether anyone took the request. Seconds of SLEEP, not CPU; a platform that caps it lower only
// loses the escalation, never the first push.
export const maxDuration = 150

const MAX_BODY_BYTES = 64 * 1024

export async function POST(request: NextRequest) {
  try {
    const bad = sameOriginJson(request, MAX_BODY_BYTES)
    if (bad) return bad
    if (!(await orderingEnabled())) return refuse('disabled')

    const token = readSessionToken(request)
    if (!token) return refuse('no_session')

    const ip = clientIp(request)
    if (!(await checkRateLimit(`table-order:${ip}`, 12, 600))) return refuse('rate_limited')
    if (!(await checkRateLimit('table-order:global', 200, 600))) return refuse('rate_limited')

    const body: unknown = await request.json().catch(() => null)
    // "Nothing new to send" is its own calm message, decided by shape — not by matching the validator's
    // (Hebrew, human-facing) wording, which is free to change.
    const items = typeof body === 'object' && body !== null ? (body as { items?: unknown }).items : undefined
    if (Array.isArray(items) && items.length === 0) return refuse('empty')
    const validated = validateSubmission(body)
    if (!validated.ok) return refuse('bad_request')
    const submission = validated.value

    const { data, error } = await createServiceClient().rpc('create_cart_submission', {
      p_token: token,
      p_payload: submission,
      p_item_count: submission.items.length,
      p_total: submission.total_agorot,
    })
    if (error) {
      // 42883 = migration 058 has not been applied.
      console.error('create_cart_submission failed:', error.code, error.message)
      return refuse('server')
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      { ok?: boolean; reason?: string | null; submission_id?: string; table_number?: number | null } | null | undefined
    if (!row) return refuse('server')
    if (!row.ok) return refuse(remoteErrorFromReason(row.reason))

    // Quantity, not lines: "4 drinks" is what a waiter's wrist should say.
    const quantity = submission.items.reduce((n, i) => n + i.qty, 0)
    if (typeof row.submission_id === 'string') {
      const submissionId = row.submission_id
      const alert = {
        submissionId,
        tableNumber: row.table_number ?? null,
        itemCount: quantity,
        totalAgorot: submission.total_agorot,
      }
      // The table's waiter is told first (061), so the push needs the TABLE — read from the request the database
      // just stored, never from anything the phone sent.
      afterResponse(async () => {
        const { data } = await createServiceClient()
          .from('customer_cart_submissions').select('table_id').eq('id', submissionId).maybeSingle()
        await notifyStaffOfSubmission({ ...alert, tableId: (data as { table_id?: string | null } | null)?.table_id ?? null })
      })
    }

    // Nothing is echoed back — not the id. The phone learns what became of it from GET /api/table/session.
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('table order route error:', err)
    return refuse('server')
  }
}
