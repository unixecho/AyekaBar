import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/owner/guard'
import { splitName } from '@/lib/staff/name'
import type { SupabaseClient, User } from '@supabase/supabase-js'

type Service = SupabaseClient

const COLS = 'id, auth_user_id, role, badge, first_name, last_name, email, created_at, invited_at, claimed_at, show_on_site, display_order, display_name, active'

/** `ilike` is our case-insensitive equality check, but `%` and `_` are legal in
 *  the local part of an address and would act as LIKE wildcards. */
const likeExact = (email: string) => email.replace(/[\\%_]/g, (c) => `\\${c}`)

// ---- helpers ----
async function findAuthUserByEmail(service: Service, email: string): Promise<User | null> {
  const target = email.trim().toLowerCase()

  // Fast path: they're almost certainly already a customer (signed in once).
  const { data: customer } = await service
    .from('customers')
    .select('auth_user_id')
    .ilike('email', likeExact(target))
    .maybeSingle()
  if (customer?.auth_user_id) {
    const { data } = await service.auth.admin.getUserById(customer.auth_user_id)
    if (data?.user) return data.user
  }

  // Fallback: scan auth users (handles someone who signed in but never opened
  // the customer dashboard, so has no customers row yet).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) break
    const match = data.users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match
    if (data.users.length < 200) break
  }
  return null
}

/** The row the owner is acting on, looked up by its own id. */
async function loadRow(service: Service, id: string) {
  const { data } = await service
    .from('staff')
    .select('id, auth_user_id, role, email, active')
    .eq('id', id)
    .maybeSingle()
  return data as
    { id: string; auth_user_id: string | null; role: string; email: string | null; active: boolean } | null
}

/** An "offline" roster entry: no account, no address, exists to be scheduled.
 *  The only rows whose name this API will rewrite — see PATCH. */
const isOffline = (row: { auth_user_id: string | null; email: string | null }) =>
  !row.auth_user_id && !row.email

// ---- GET: list the roster (claimed + pending invites) ----
export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('staff')
    .select(COLS)
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'טעינת הצוות נכשלה' }, { status: 500 })
  return NextResponse.json({ staff: data ?? [] })
}

// ---- POST: put a person on the roster ----
//
// Two shapes, because a bar has two kinds of staff:
//
//   WITH an email — the person gets an account. They do NOT have to have
//   signed in yet: if we can already match the email to an auth user we link
//   it right away; otherwise the row is a pending invite (auth_user_id null)
//   and `claim_staff_invite()` links it the first time that Google account
//   signs in.
//
//   WITHOUT an email ("offline", 2026-08-29) — the person exists only to be
//   scheduled. A busboy who works Fridays and has no reason to hold an
//   account still has to appear in the shift builder, and requiring a Google
//   address to roster them meant either inventing a fake one or leaving them
//   off the schedule entirely. The row carries a name and a badge and nothing
//   else; it can never sign in, and `claim_staff_invite()` cannot match it,
//   both by construction rather than by a flag someone could flip.
//
// The schema already permitted this — migration 006 made auth_user_id
// nullable and scoped the unique email index to `where email is not null` —
// so this is a route-level restriction being lifted, not a data change.
export async function POST(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { email?: string; badge?: string; role?: string; firstName?: string; lastName?: string } | null
  const email = body?.email?.trim().toLowerCase()
  const badge = body?.badge?.trim() || null
  const role = body?.role === 'owner' ? 'owner' : 'staff'

  if (!email) {
    const first = body?.firstName?.trim()
    const last = body?.lastName?.trim() || null
    if (!first) return NextResponse.json({ error: 'חסר שם או אימייל' }, { status: 400 })
    if (first.length > 60 || (last && last.length > 60)) {
      return NextResponse.json({ error: 'השם ארוך מדי' }, { status: 400 })
    }
    // Admin rights are meaningless on a row that can never authenticate, and
    // storing role='owner' here would inflate the "last owner" guard in DELETE
    // with an account nobody can sign into. Forced to 'staff'.
    const { data, error } = await auth.service
      .from('staff')
      .insert({
        auth_user_id: null, role: 'staff', badge,
        first_name: first, last_name: last,
        email: null, claimed_at: null,
      })
      .select(COLS)
      .single()

    if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })
    return NextResponse.json({ member: data, offline: true })
  }

  // Already on the roster (claimed, pending, OR previously removed)? Update
  // instead of failing on the unique email index — and a removed row comes
  // back to life rather than staying invisible, the same "re-invite ==
  // restore" shortcut reactivateTable() gives the floor plan.
  const { data: existing } = await auth.service
    .from('staff').select('id, active').ilike('email', likeExact(email)).maybeSingle()
  if (existing) {
    const { data, error } = await auth.service
      .from('staff')
      .update({ role, badge, active: true })
      .eq('id', existing.id)
      .select(COLS)
      .single()
    if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })
    return NextResponse.json({ member: data, updated: true, reactivated: !existing.active })
  }

  const user = await findAuthUserByEmail(auth.service, email)
  const names = user ? splitName(user) : { first: null, last: null }

  const { data, error } = await auth.service
    .from('staff')
    .insert({
      auth_user_id: user?.id ?? null,
      role,
      badge,
      first_name: names.first,
      last_name: names.last,
      email: user?.email ?? email,
      claimed_at: user ? new Date().toISOString() : null,
    })
    .select(COLS)
    .single()

  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })
  return NextResponse.json({ member: data, pending: !user })
}

// ---- PATCH: update a member's role/badge ----
export async function PATCH(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    {
      id?: string; badge?: string | null; role?: string; active?: unknown
      showOnSite?: unknown; displayOrder?: unknown; displayName?: unknown
    } | null
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const row = await loadRow(auth.service, id)
  if (!row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (body && 'badge' in body) patch.badge = body.badge?.trim() || null

  // Restore only — the other half of DELETE's deactivate. `active: false`
  // is refused here on purpose: DELETE is the one path that carries the
  // self-lockout / last-owner guards, and a second route to the same write
  // without them is how those guards get quietly bypassed.
  if (body && 'active' in body) {
    if (body.active !== true) {
      return NextResponse.json({ error: 'להסרה יש להשתמש בפעולת ההסרה' }, { status: 400 })
    }
    patch.active = true
  }

  // Turn an "offline" row into a real account — "add a Gmail to staff so
  // they can later log in and watch the scheduler or enter the OMS if
  // permitted," 2026-08-30. An offline row has no email/auth_user_id by
  // construction (see POST's own comment on why); this is the one way out
  // of that, producing exactly what POST's email branch would have created
  // had the owner typed the address from the start — pending if nobody's
  // signed in with it yet, linked immediately if they already have.
  // Restricted to offline rows the same way the name fields above are:
  // a LINKED or PENDING row's email is what claim_staff_invite() matches
  // on, and silently repointing it here (instead of revoke + re-invite,
  // which is a deliberate, visible two-step action) risks detaching
  // history from the person it's actually about with no confirmation at all.
  // Deliberately does NOT touch first_name/last_name — an offline row's
  // name was typed by the owner on purpose; claim_staff_invite() itself
  // only ever fills a NULL name from the Google profile, never overwrites
  // an existing one, and this follows the same rule.
  if (body && 'email' in body) {
    if (!isOffline(row)) {
      return NextResponse.json(
        { error: 'אפשר להוסיף אימייל רק לאיש/אשת צוות שנוסף/ה בלי חשבון' },
        { status: 400 }
      )
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'אימייל לא תקין' }, { status: 400 })
    }
    const { data: existingEmail } = await auth.service
      .from('staff').select('id').ilike('email', likeExact(email)).maybeSingle()
    if (existingEmail) {
      return NextResponse.json({ error: 'האימייל הזה כבר משויך לאיש/אשת צוות אחר/ת' }, { status: 400 })
    }
    const user = await findAuthUserByEmail(auth.service, email)
    patch.email = user?.email ?? email
    patch.auth_user_id = user?.id ?? null
    patch.claimed_at = user ? new Date().toISOString() : null
  }

  // Real name, editable for offline rows ONLY. For everyone else first/last
  // are a snapshot of their Google profile and `claim_staff_invite()` writes
  // them on first sign-in — letting the owner edit those would produce a name
  // that silently reverts, which is worse than not offering the field. An
  // offline row has no profile to snapshot and no claim path, so its name is
  // the only name it will ever have, and a typo in it must be fixable.
  if (body && ('firstName' in body || 'lastName' in body)) {
    if (!isOffline(row)) {
      return NextResponse.json(
        { error: 'אפשר לערוך שם רק לאיש/אשת צוות ללא חשבון' },
        { status: 400 }
      )
    }
    if ('firstName' in body) {
      const first = typeof body.firstName === 'string' ? body.firstName.trim() : ''
      if (!first) return NextResponse.json({ error: 'חסר שם' }, { status: 400 })
      if (first.length > 60) return NextResponse.json({ error: 'השם ארוך מדי' }, { status: 400 })
      patch.first_name = first
    }
    if ('lastName' in body) {
      const last = typeof body.lastName === 'string' ? body.lastName.trim() : ''
      if (last.length > 60) return NextResponse.json({ error: 'השם ארוך מדי' }, { status: 400 })
      patch.last_name = last || null
    }
  }

  // Publish/unpublish on the public team page.
  if (body && 'showOnSite' in body) {
    if (typeof body.showOnSite !== 'boolean') {
      return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })
    }
    // A pending invite is just an email the owner typed — the person hasn't
    // signed in, and public_staff filters them out anyway. Refuse rather than
    // silently storing a flag that does nothing.
    if (body.showOnSite && !row.auth_user_id) {
      return NextResponse.json(
        { error: 'אפשר להציג באתר רק אחרי הכניסה הראשונה' },
        { status: 400 }
      )
    }
    patch.show_on_site = body.showOnSite
  }

  // Presentation-only override for the public team page. Never touches
  // first_name/last_name/email — the invite-claim flow matches on those.
  if (body && 'displayName' in body) {
    const v = body.displayName
    if (v !== null && typeof v !== 'string') {
      return NextResponse.json({ error: 'שם לא תקין' }, { status: 400 })
    }
    const trimmed = typeof v === 'string' ? v.trim() : null
    if (trimmed && trimmed.length > 60) {
      return NextResponse.json({ error: 'השם ארוך מדי' }, { status: 400 })
    }
    patch.display_name = trimmed || null
  }

  if (body && 'displayOrder' in body) {
    const v = body.displayOrder
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v))) {
      return NextResponse.json({ error: 'סדר לא תקין' }, { status: 400 })
    }
    patch.display_order = v
  }
  if (body?.role) {
    if (body.role !== 'staff' && body.role !== 'owner') {
      return NextResponse.json({ error: 'תפקיד לא תקין' }, { status: 400 })
    }
    // Don't let an owner strip their own owner access.
    if (row.auth_user_id === auth.userId && body.role !== 'owner') {
      return NextResponse.json({ error: 'אי אפשר לשנות את התפקיד של עצמך' }, { status: 400 })
    }
    // Granting admin to a row that cannot authenticate grants nothing, and it
    // would let a never-signable row count toward the "at least one owner"
    // guard in DELETE — which is how a bar locks itself out of its own panel.
    if (body.role === 'owner' && isOffline(row)) {
      return NextResponse.json(
        { error: 'אי אפשר לתת הרשאות לאיש/אשת צוות ללא חשבון' },
        { status: 400 }
      )
    }
    patch.role = body.role
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'אין מה לעדכן' }, { status: 400 })
  }

  const { data, error } = await auth.service
    .from('staff').update(patch).eq('id', id).select(COLS).single()

  if (error) return NextResponse.json({ error: 'עדכון נכשל' }, { status: 500 })

  // /team is ISR-cached; publishing someone should show up now, not in 5 min.
  revalidatePath('/team')

  return NextResponse.json({ member: data })
}

// ---- DELETE: remove a staff member (or revoke a pending invite) ----
export async function DELETE(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as { id?: string } | null
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const row = await loadRow(auth.service, id)
  if (!row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })

  // Prevent self-lockout.
  if (row.auth_user_id === auth.userId) {
    return NextResponse.json({ error: 'אי אפשר להסיר את עצמך' }, { status: 400 })
  }

  // Prevent removing the last owner. Only claimed owners count — a pending
  // owner invite can't sign in yet, so it can't rescue a locked-out bar (and
  // revoking such an invite is always safe).
  if (row.role === 'owner' && row.auth_user_id) {
    const { count } = await auth.service
      .from('staff').select('id', { count: 'exact', head: true })
      .eq('role', 'owner').not('auth_user_id', 'is', null)
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'חייב להישאר לפחות בעלים אחד' }, { status: 400 })
    }
  }

  // Deactivate, never delete — same pattern deactivateTable() already uses
  // for the floor plan (migration 028), and for the same reason: historical
  // orders/events still point at this row (registered_by, claimed_by,
  // delivered_by, voided_by, picked_up_by, actor_staff_id, waiter_staff_id,
  // and half a dozen more, mostly ON DELETE NO ACTION) — a hard DELETE on
  // anyone with real activity fails outright, which was exactly the
  // "מחיקה נכשלה" bug for staff who'd actually worked a shift.
  //
  // auth_user_id is cleared alongside `active` — not just for tidiness.
  // Every access check in this app (isOp/canEditMenu/isStaff, the SQL
  // is_op()/is_menu_editor()/is_floor_manager()/is_schedule_manager()/
  // is_staff_client() functions, middleware, and every /owner/* page's own
  // server-side re-check) resolves "who is signed in" as `staff WHERE
  // auth_user_id = auth.uid()`. Nulling it here means that lookup finds NO
  // row for this person's next request — access is revoked EVERYWHERE those
  // checks already run, without touching any of them. See migration
  // 041_staff_soft_delete.sql's own note on why claim_staff_invite() also
  // had to change: without that fix, the same person signing in again would
  // silently re-link and undo this.
  const { error } = await auth.service
    .from('staff')
    .update({ active: false, auth_user_id: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'ההסרה נכשלה' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
