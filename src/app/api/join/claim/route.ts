import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { CLAIM_STATUS, JOIN_LIMITS, isJoinToken, messageFor } from '@/lib/staff/join'
import { claimJoin } from '@/lib/staff/join-server'

// POST /api/join/claim  { token }  — the wizard's "confirm" step: link the Google account that is signed in RIGHT
// NOW to the roster entry the join link names.
//
// WHO IS LINKED comes from the SESSION (the cookie-bound client), never from the body: a request can say which
// link it holds, not whose account to attach it to. The database function (migration 059, service-role only)
// then decides — a confirmed Google identity, a link that is live and unspent, a row that is active, unlinked and
// not an owner, and an address nobody else on the roster is using. All of that is in SQL because it has to be one
// atomic decision; this route is the thin door in front of it.
//
// There is NO enabling switch: a link only exists because an owner pressed the button, and that is the switch.
//
// Order of refusals, cheapest first: same-origin → signed in → token shape → rate limit → the database.
// The token has 256 bits, so the rate limit is about noise and double-taps, not guessing.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

const fail = (code: string, status: number, message: string) =>
  NextResponse.json({ ok: false, error: code, message }, { status, headers: NO_STORE })

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin) {
    let host: string | null = null
    try { host = new URL(origin).host } catch { host = null }
    if (!host || host !== request.headers.get('host')) return fail('bad_request', 403, 'בקשה לא תקינה.')
  }

  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return fail('no_user', 401, messageFor('no_user').body)

  const body = await request.json().catch(() => null) as { token?: unknown } | null
  if (!isJoinToken(body?.token)) return fail('unknown', 404, messageFor('unknown').body)

  const ok =
    (await checkRateLimit(`join-claim:${user.id}`, JOIN_LIMITS.claim.max, JOIN_LIMITS.claim.windowSeconds)) &&
    (await checkRateLimit(`join-claim:ip:${clientIp(request)}`, JOIN_LIMITS.claim.max * 3, JOIN_LIMITS.claim.windowSeconds))
  if (!ok) return fail('rate_limited', 429, 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות.')

  const out = await claimJoin(createServiceClient(), body!.token as string, user.id)
  if (out.notSetUp) return fail('not_set_up', 503, 'ההצטרפות בקישור עדיין לא הופעלה. פנו למנהל.')
  if (out.failed) return fail('server', 500, 'משהו השתבש. נסו שוב.')
  if (!out.ok) {
    const reason = out.reason ?? 'unknown'
    return fail(reason, CLAIM_STATUS[reason], `${messageFor(reason).title}. ${messageFor(reason).body}`.trim())
  }
  return NextResponse.json({ ok: true, already: out.already }, { headers: NO_STORE })
}
