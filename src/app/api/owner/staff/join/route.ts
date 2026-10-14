import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'
import { checkRateLimit } from '@/lib/rate-limit'
import { JOIN_LIMITS, joinPath } from '@/lib/staff/join'
import { issueJoin, mintJoinToken, revokeJoin, type IssueReason } from '@/lib/staff/join-server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// POST   /api/owner/staff/join  { id }  → a fresh join link for one person on the roster
// DELETE /api/owner/staff/join  { id }  → cancel their live link
//
// "Owners need to have a link to give freshly created employee accounts" (owner, 2026-10-14). The link is a
// bearer secret that exists in exactly two places: the response below, once, and whatever the owner sends it
// through. Only its SHA-256 is stored (migration 059), so there is no "show me the link again" — generating a
// new one is the answer, and it retires the old.
//
// THE OWNER GATE is requireOwner(): full admin only, the same circle that adds people to the roster in the
// first place. Same-origin only, because this is an authenticated, state-changing request.
//
// Never cached: the response carries a secret.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

const MESSAGES: Record<IssueReason | 'unauthorized' | 'rate_limited' | 'bad_request', string> = {
  unauthorized: 'יש להתחבר מחדש.',
  rate_limited: 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות.',
  bad_request: 'בקשה לא תקינה.',
  no_staff: 'איש הצוות לא נמצא.',
  inactive: 'הכרטיס הזה הוסר מהצוות. שחזרו אותו קודם.',
  already_linked: 'האדם הזה כבר מחובר עם חשבון Google — אין צורך בקישור.',
  owner_role: 'הרשאות ניהול ניתנות בהזמנה לפי אימייל ולא בקישור.',
  bad_hash: 'משהו השתבש. נסו שוב.',
  not_set_up: 'קישורי ההצטרפות עדיין לא הופעלו במערכת. פנו למפתח.',
  server: 'משהו השתבש. נסו שוב.',
}

const STATUS: Record<IssueReason, number> = {
  no_staff: 404, inactive: 409, already_linked: 409, owner_role: 403, bad_hash: 500, not_set_up: 503, server: 500,
}

const refuse = (code: keyof typeof MESSAGES, status: number) =>
  NextResponse.json({ error: code, message: MESSAGES[code] }, { status, headers: NO_STORE })

function foreignOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return false
  let host: string | null = null
  try { host = new URL(origin).host } catch { host = null }
  return !host || host !== request.headers.get('host')
}

export async function POST(request: NextRequest) {
  if (foreignOrigin(request)) return refuse('unauthorized', 403)
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  if (!(await checkRateLimit(`join-issue:${auth.userId}`, JOIN_LIMITS.issue.max, JOIN_LIMITS.issue.windowSeconds))) {
    return refuse('rate_limited', 429)
  }

  const body = await request.json().catch(() => null) as { id?: unknown } | null
  if (!isUuid(body?.id)) return refuse('bad_request', 400)

  const [{ data: actor }, { data: target }] = await Promise.all([
    auth.service.from('staff').select('id').eq('auth_user_id', auth.userId).maybeSingle(),
    auth.service.from('staff').select('first_name').eq('id', body!.id as string).maybeSingle(),
  ])

  const { token, hash } = mintJoinToken()
  const out = await issueJoin(auth.service, body!.id as string, actor?.id ?? null, hash)
  if (!out.ok) return refuse(out.reason, STATUS[out.reason])

  // The link points at the host the owner is on — a host where sign-in is known to work.
  const url = `${request.nextUrl.origin}${joinPath(token)}`
  return NextResponse.json(
    { ok: true, url, expiresAt: out.expiresAt, firstName: target?.first_name ?? null },
    { headers: NO_STORE },
  )
}

export async function DELETE(request: NextRequest) {
  if (foreignOrigin(request)) return refuse('unauthorized', 403)
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as { id?: unknown } | null
  if (!isUuid(body?.id)) return refuse('bad_request', 400)

  const out = await revokeJoin(auth.service, body!.id as string)
  if (out.notSetUp) return refuse('not_set_up', 503)
  if (!out.ok) return refuse('server', 500)
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
