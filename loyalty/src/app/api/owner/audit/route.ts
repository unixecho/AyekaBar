import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'
import { logAudit } from '@/lib/owner/audit'

// GET  — the audit trail for the owner dashboard.
// POST — record a menu save/publish.
//
// Why POST exists: the editor writes menus.draft and calls publish_menu()
// straight from the browser under RLS, so there is no server route to hook.
// Rather than reroute the whole editor, it reports the action here. Only these
// two actions are accepted, and the actor is taken from the SESSION — never
// from the body — so this cannot be used to forge entries against someone else.

const CLIENT_ACTIONS = new Set(['menu.save', 'menu.publish'])

export async function GET(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 50, 200)

  const { data, error } = await auth.service
    .from('menu_audit')
    .select('id, actor_name, actor_email, action, summary, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  // The table arrives with migration 014; before that the dashboard should
  // show an empty trail rather than an error.
  if (error) return NextResponse.json({ entries: [], pending: true })

  return NextResponse.json({ entries: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { action?: unknown; summary?: unknown; detail?: unknown } | null

  const action = typeof body?.action === 'string' ? body.action : ''
  if (!CLIENT_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'פעולה לא תקינה' }, { status: 400 })
  }

  const summary = typeof body?.summary === 'string' ? body.summary.slice(0, 200) : ''
  const detail = (typeof body?.detail === 'object' && body.detail !== null)
    ? body.detail as Record<string, unknown>
    : {}

  await logAudit(auth.service, auth.userId, action as 'menu.save' | 'menu.publish', summary, detail)
  return NextResponse.json({ ok: true })
}
