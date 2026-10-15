import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import {
  JOIN_INTENT_COOKIE, JOIN_INTENT_PATH, JOIN_INTENT_TTL_SECONDS, isJoinToken,
} from '@/lib/staff/join'

// POST /api/join/intent  { token }  — "this browser is walking join link <token>" (2026-10-15).
//
// WHY. The wizard sends the person to Google and Google sends them back to /auth/callback — and the callback has to know the
// person came from a join link, to send them back to it. The wizard used to say so in the URL (`?next=/join/<token>`); a
// redirect allow-list that lists `/auth/callback` exactly rejects that, and the person landed on the portal. So the URL is
// now plain, and the memory lives here: an HttpOnly cookie, sent ONLY to /auth/callback, gone after fifteen minutes or at
// the first return trip. Declared in lib/privacy/registry.ts (`join-intent`).
//
// IT IS PUBLIC, on purpose (the person is not signed in yet), so it holds nothing it could be abused for: it checks the token's
// SHAPE (43 base64url characters — anything else is a 400 and sets nothing), is same-origin only, and is rate limited per IP. It
// does not check that the link is LIVE; the wizard page does that when it is opened, and the callback only ever redirects to
// `/join/<that token>`, never to a URL a caller chose.
//
// ⚠️ Next mirrors every response.cookies.set() into an `x-middleware-set-cookie` header that page JavaScript CAN read (found
// 2026-10-13 on the table-session cookie). The cookie's value is the join link's secret, so the mirror is dropped.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const sealed = (response: NextResponse): NextResponse => {
  response.headers.delete('x-middleware-set-cookie')
  return response
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (origin) {
    let host: string | null = null
    try { host = new URL(origin).host } catch { host = null }
    if (!host || host !== request.headers.get('host')) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE })
  }

  const body = await request.json().catch(() => null) as { token?: unknown } | null
  if (!isJoinToken(body?.token)) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE })

  if (!(await checkRateLimit(`join-intent:ip:${clientIp(request)}`, 30, 600))) {
    return NextResponse.json({ ok: false }, { status: 429, headers: NO_STORE })
  }

  const response = NextResponse.json({ ok: true }, { headers: NO_STORE })
  response.cookies.set(JOIN_INTENT_COOKIE, body!.token as string, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: JOIN_INTENT_PATH,
    maxAge: JOIN_INTENT_TTL_SECONDS,
  })
  return sealed(response)
}
