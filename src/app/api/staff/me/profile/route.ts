import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireStaff } from '@/lib/staff/guard'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { pickIdentity, validateProfile } from '@/lib/staff/profile'

// A person's OWN details — first and last name, phone, colour, emoji (2026-10-15; the onboarding wizard's "details" step).
//
// WHO IS EDITED comes from the SESSION, never the request: the row is `staff WHERE auth_user_id = <the signed-in user>`.
// The body carries values and nothing that names a person, so there is no id to tamper with, and a signed-in Google
// account that is not on the roster (requireStaff) cannot reach it at all. Nothing here can change access (role, badge,
// active, email, auth_user_id are never written).
//
// The phone is the one column that may not exist yet (migration 062): it is read and written on its own, so before 062
// the rest still saves and the answer says `phoneReady: false` — the form then simply does not offer the field.

const COLS = 'id, first_name, last_name, colour, initial'

async function phoneState(service: SupabaseClient, id: string): Promise<{ ready: boolean; phone: string | null }> {
  const r = await service.from('staff').select('phone').eq('id', id).maybeSingle()
  if (r.error) return { ready: false, phone: null }
  return { ready: true, phone: (r.data?.phone as string | null) ?? null }
}

export async function GET() {
  const auth = await requireStaff()
  if (!auth.ok) return auth.res

  const { data: me } = await auth.service.from('staff').select(COLS).eq('auth_user_id', auth.userId).maybeSingle()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ph = await phoneState(auth.service, me.id as string)
  // A person created before 2026-10-15 has no colour or emoji: offer a random one (the least-used among the roster), so
  // the form always opens with a choice made — saving it is what makes it theirs.
  let suggested = null as ReturnType<typeof pickIdentity> | null
  if (!me.colour || !me.initial) {
    const { data: used } = await auth.service.from('staff').select('colour, initial').eq('active', true)
    suggested = pickIdentity(used ?? [])
  }
  return NextResponse.json({
    firstName: me.first_name ?? '', lastName: me.last_name ?? '',
    colour: me.colour ?? suggested?.colour ?? null, initial: me.initial ?? suggested?.initial ?? null,
    phone: ph.phone ?? '', phoneReady: ph.ready,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireStaff()
  if (!auth.ok) return auth.res
  if (!(await checkRateLimit(`staff-profile:${auth.userId}`, 30, 600))) return rateLimitResponse()

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })

  const checked = validateProfile({
    firstName: body.firstName, lastName: body.lastName, phone: body.phone, colour: body.colour, initial: body.initial,
  })
  if (!checked.ok) return NextResponse.json({ error: checked.message, field: checked.error }, { status: 400 })

  const { first_name, last_name, phone, colour, initial } = checked.value
  const { data: me } = await auth.service.from('staff').select('id').eq('auth_user_id', auth.userId).maybeSingle()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const patch: Record<string, unknown> = { first_name, last_name }
  if (colour !== undefined) patch.colour = colour
  if (initial !== undefined) patch.initial = initial
  const { error } = await auth.service.from('staff').update(patch).eq('id', me.id)
  if (error) {
    console.error('profile update failed:', error.code, String(error.message ?? '').slice(0, 200))
    return NextResponse.json({ error: 'השמירה נכשלה. נסו שוב.' }, { status: 500 })
  }

  // The phone on its own, so a missing column (062 not applied) never blocks the rest.
  let phoneSaved: boolean | null = null
  if (phone !== undefined) {
    const r = await auth.service.from('staff').update({ phone }).eq('id', me.id)
    phoneSaved = !r.error
    if (r.error && r.error.code !== '42703' && !/column .*phone/i.test(r.error.message ?? '')) {
      console.error('profile phone update failed:', r.error.code, String(r.error.message ?? '').slice(0, 200))
    }
  }
  return NextResponse.json({ ok: true, phoneSaved })
}
