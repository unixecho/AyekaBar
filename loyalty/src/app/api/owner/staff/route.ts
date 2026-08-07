import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/owner/guard'
import { splitName } from '@/lib/staff/name'
import type { SupabaseClient, User } from '@supabase/supabase-js'

type Service = SupabaseClient

const COLS = 'id, auth_user_id, role, badge, first_name, last_name, email, created_at, invited_at, claimed_at, show_on_site, display_order'

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
    .select('id, auth_user_id, role')
    .eq('id', id)
    .maybeSingle()
  return data as { id: string; auth_user_id: string | null; role: string } | null
}

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

// ---- POST: authorize a person by email ----
// The person does NOT have to have signed in yet. If we can already match the
// email to an auth user we link it right away; otherwise the row is stored as a
// pending invite (auth_user_id null) and `claim_staff_invite()` links it the
// first time that Google account signs in.
export async function POST(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { email?: string; badge?: string; role?: string } | null
  const email = body?.email?.trim().toLowerCase()
  const badge = body?.badge?.trim() || null
  const role = body?.role === 'owner' ? 'owner' : 'staff'
  if (!email) return NextResponse.json({ error: 'חסר אימייל' }, { status: 400 })

  // Already on the roster (claimed or pending)? Update instead of failing on
  // the unique email index.
  const { data: existing } = await auth.service
    .from('staff').select('id').ilike('email', likeExact(email)).maybeSingle()
  if (existing) {
    const { data, error } = await auth.service
      .from('staff')
      .update({ role, badge })
      .eq('id', existing.id)
      .select(COLS)
      .single()
    if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })
    return NextResponse.json({ member: data, updated: true })
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
      id?: string; badge?: string | null; role?: string
      showOnSite?: unknown; displayOrder?: unknown
    } | null
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const row = await loadRow(auth.service, id)
  if (!row) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (body && 'badge' in body) patch.badge = body.badge?.trim() || null

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

  const { error } = await auth.service.from('staff').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'מחיקה נכשלה' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
