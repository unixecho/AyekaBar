import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { splitName } from '@/lib/staff/name'
import type { SupabaseClient, User } from '@supabase/supabase-js'

type Service = SupabaseClient

// ---- authorization: caller must be a signed-in owner ----
async function requireOwner(): Promise<
  | { ok: true; service: Service; userId: string }
  | { ok: false; res: NextResponse }
> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const service = createServiceClient()
  const { data: me } = await service
    .from('staff')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!me || me.role !== 'owner') {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, service, userId: user.id }
}

// ---- helpers ----
async function findAuthUserByEmail(service: Service, email: string): Promise<User | null> {
  const target = email.trim().toLowerCase()

  // Fast path: they're almost certainly already a customer (signed in once).
  const { data: customer } = await service
    .from('customers')
    .select('auth_user_id')
    .ilike('email', target)
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

// ---- GET: list all staff (owner's roster) ----
export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('staff')
    .select('auth_user_id, role, badge, first_name, last_name, email, created_at')
    .order('role', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to load staff' }, { status: 500 })
  return NextResponse.json({ staff: data ?? [] })
}

// ---- POST: add a staff member by email ----
export async function POST(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { email?: string; badge?: string; role?: string } | null
  const email = body?.email?.trim()
  const badge = body?.badge?.trim() || null
  const role = body?.role === 'owner' ? 'owner' : 'staff'
  if (!email) return NextResponse.json({ error: 'חסר אימייל' }, { status: 400 })

  const user = await findAuthUserByEmail(auth.service, email)
  if (!user) {
    return NextResponse.json(
      { error: 'לא נמצא משתמש עם האימייל הזה. הוא צריך להיכנס עם Google פעם אחת קודם.' },
      { status: 404 }
    )
  }

  const { first, last } = splitName(user)
  const { data, error } = await auth.service
    .from('staff')
    .upsert({
      auth_user_id: user.id,
      role,
      badge,
      first_name: first,
      last_name: last,
      email: user.email ?? email,
    }, { onConflict: 'auth_user_id' })
    .select('auth_user_id, role, badge, first_name, last_name, email, created_at')
    .single()

  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })
  return NextResponse.json({ member: data })
}

// ---- PATCH: update a member's role/badge ----
export async function PATCH(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { authUserId?: string; badge?: string | null; role?: string } | null
  const authUserId = body?.authUserId
  if (!authUserId) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body && 'badge' in body) patch.badge = body.badge?.trim() || null
  if (body?.role) {
    if (body.role !== 'staff' && body.role !== 'owner') {
      return NextResponse.json({ error: 'תפקיד לא תקין' }, { status: 400 })
    }
    // Don't let an owner strip their own owner access.
    if (authUserId === auth.userId && body.role !== 'owner') {
      return NextResponse.json({ error: 'אי אפשר לשנות את התפקיד של עצמך' }, { status: 400 })
    }
    patch.role = body.role
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'אין מה לעדכן' }, { status: 400 })
  }

  const { data, error } = await auth.service
    .from('staff')
    .update(patch)
    .eq('auth_user_id', authUserId)
    .select('auth_user_id, role, badge, first_name, last_name, email, created_at')
    .single()

  if (error) return NextResponse.json({ error: 'עדכון נכשל' }, { status: 500 })
  return NextResponse.json({ member: data })
}

// ---- DELETE: remove a staff member ----
export async function DELETE(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as { authUserId?: string } | null
  const authUserId = body?.authUserId
  if (!authUserId) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  // Prevent self-lockout.
  if (authUserId === auth.userId) {
    return NextResponse.json({ error: 'אי אפשר להסיר את עצמך' }, { status: 400 })
  }

  // Prevent removing the last owner.
  const { data: target } = await auth.service
    .from('staff').select('role').eq('auth_user_id', authUserId).maybeSingle()
  if (target?.role === 'owner') {
    const { count } = await auth.service
      .from('staff').select('auth_user_id', { count: 'exact', head: true }).eq('role', 'owner')
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'חייב להישאר לפחות בעלים אחד' }, { status: 400 })
    }
  }

  const { error } = await auth.service.from('staff').delete().eq('auth_user_id', authUserId)
  if (error) return NextResponse.json({ error: 'מחיקה נכשלה' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
