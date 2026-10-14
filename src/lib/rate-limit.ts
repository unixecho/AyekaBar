import { createServiceClient } from '@/lib/supabase/server'

// Thin wrapper around the DB-backed check_rate_limit() function (migration
// 045). See that migration's own header for why this is table-backed
// instead of an in-memory counter — Vercel serverless instances don't share
// memory, Postgres is the one thing every request already talks to.
//
// Fails OPEN, not closed: if the rate-limit check itself errors (network
// blip, etc.), the request is allowed through rather than blocking real
// traffic because of an unrelated outage. A rate limiter's job is to blunt
// abuse, not to become a new single point of failure for the feature it's
// protecting.
export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const service = createServiceClient()
    const { data, error } = await service.rpc('check_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error('check_rate_limit error:', error)
      return true
    }
    return data === true
  } catch (err) {
    console.error('check_rate_limit threw:', err)
    return true
  }
}

// READ-ONLY: has `key` already used up `max` inside its window? check_rate_limit() can't
// answer that — it increments on every call — and a counter of FAILURES has to be looked at
// BEFORE the next attempt is evaluated, not after it has already been tried. So this reads
// the counter's own row (service role; the table has RLS on and no policies) and never
// writes. The table-code route (049's "global failed-redemption counter") records a wrong
// guess with checkRateLimit() and gates each attempt with this.
//
// Fails OPEN like its sibling: an unreadable counter must not lock customers out of the
// feature. (The per-IP limit, which does fail open too, still stands in front.)
export async function peekRateLimitExceeded(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const service = createServiceClient()
    const { data, error } = await service.from('rate_limits').select('window_start, count').eq('key', key).maybeSingle()
    if (error || !data) return false
    const ageMs = Date.now() - new Date(data.window_start as string).getTime()
    if (!Number.isFinite(ageMs) || ageMs > windowSeconds * 1000) return false
    return (data.count as number) >= max
  } catch (err) {
    console.error('peekRateLimitExceeded threw:', err)
    return false
  }
}

// The caller's IP, the same header this app already trusts for fraud_log
// (src/app/api/loyalty/checkin/route.ts) — Vercel sets x-forwarded-for on
// every request, so this isn't spoofable by the client the way most other
// headers are.
export function clientIp(request: { headers: { get(name: string): string | null } }): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export function rateLimitResponse() {
  return Response.json({ error: 'יותר מדי בקשות — נסה שוב בעוד רגע.' }, { status: 429 })
}
