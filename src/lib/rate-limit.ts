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

// The caller's IP, the same header this app already trusts for fraud_log
// (src/app/api/loyalty/checkin/route.ts) — Vercel sets x-forwarded-for on
// every request, so this isn't spoofable by the client the way most other
// headers are.
export function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

export function rateLimitResponse() {
  return Response.json({ error: 'יותר מדי בקשות — נסה שוב בעוד רגע.' }, { status: 429 })
}
