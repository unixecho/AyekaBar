import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { afterResponse } from '@/lib/server/after'
import { notifyItemsReady, notifyItemsSent } from '@/lib/push/station-events'

// The POS (staff.ayeka.bar) tells the portal "something just happened on the floor, push the right people"
// (2026-10-15). Two events: items marked READY (→ the table's waiter) and items SENT to a station (→ the people
// checked in there). See lib/push/station-events.ts for why the request carries only IDS.
//
// ── WHY THIS ROUTE EXISTS AT ALL ────────────────────────────────────────
// The POS writes straight to Postgres, so nothing server-side hears about a bartender tapping "ready" — and a phone
// in a pocket cannot be told about it by the POS tab it is no longer looking at. The POS therefore pings this route
// right after each of those writes (fetch keepalive, so closing the tab does not cancel it).
//
// ── GUARD RAILS, IN ORDER ───────────────────────────────────────────────
//   1. CORS: only the POS's own origin(s) get an Access-Control-Allow-Origin. (That is hygiene, not security — the
//      token below is the security.)
//   2. a Supabase ACCESS TOKEN in `Authorization: Bearer …`, verified by the Auth server, belonging to an ACTIVE staff
//      member. The POS is another origin and has no portal cookie, so the token is how it says who it is.
//   3. a per-person and a global rate limit (a push storm is the one way this could be abused).
//   4. strict validation: uuids, bounded lists, a known `kind`.
//   5. the work itself runs AFTER the response (afterResponse) — a slow push service never slows the POS — and
//      re-reads everything it needs from the database.
// Nothing is echoed back except `{ ok: true }`.

export const dynamic = 'force-dynamic'

const ALLOWED_ORIGINS = new Set([
  'https://staff.ayeka.bar',
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
])

const MAX_BODY_BYTES = 4 * 1024

const body = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('items-ready'), orderId: z.string().uuid(), itemIds: z.array(z.string().uuid()).min(1).max(30) }).strict(),
  z.object({ kind: z.literal('items-sent'), orderId: z.string().uuid(), batchNo: z.number().int().min(1).max(500) }).strict(),
])

function cors(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}

const reply = (origin: string | null, status: number, json: Record<string, unknown>) =>
  NextResponse.json(json, { status, headers: { ...cors(origin), 'Cache-Control': 'no-store' } })

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request.headers.get('origin')) })
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  try {
    // 1. Only the POS's own origin (a request with no Origin is not a browser cross-site request: let it reach the token).
    if (origin && !ALLOWED_ORIGINS.has(origin)) return reply(null, 403, { error: 'forbidden' })
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply(origin, 413, { error: 'too_big' })

    // 2. Who is asking.
    const auth = request.headers.get('authorization') ?? ''
    const token = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/.exec(auth)?.[1]
    if (!token) return reply(origin, 401, { error: 'unauthorized' })
    const service = createServiceClient()
    const { data: userData, error: userError } = await service.auth.getUser(token)
    const userId = userData?.user?.id
    if (userError || !userId) return reply(origin, 401, { error: 'unauthorized' })
    const { data: staff } = await service.from('staff').select('id, active').eq('auth_user_id', userId).maybeSingle()
    if (!staff || (staff as { active?: boolean }).active !== true) return reply(origin, 403, { error: 'forbidden' })
    const staffId = (staff as { id: string }).id

    // 3. Rate limits: a busy floor sends a few a minute, not hundreds.
    if (!(await checkRateLimit(`staff-event:${staffId}`, 90, 60))) return reply(origin, 429, { error: 'rate_limited' })
    if (!(await checkRateLimit('staff-event:global', 600, 60))) return reply(origin, 429, { error: 'rate_limited' })

    // 4. Validation.
    const parsed = body.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return reply(origin, 400, { error: 'bad_request' })

    // 5. The work, after the response.
    const event = parsed.data
    afterResponse(() => (event.kind === 'items-ready' ? notifyItemsReady(event.orderId, event.itemIds) : notifyItemsSent(event.orderId, event.batchNo)))
    return reply(origin, 200, { ok: true })
  } catch (err) {
    console.error('staff-event route error:', err instanceof Error ? err.message : err)
    return reply(origin, 500, { error: 'server' })
  }
}
