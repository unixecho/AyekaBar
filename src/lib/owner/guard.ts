import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isOp, canEditMenu, type AccessRow } from '@/lib/staff/access'

type Guarded =
  | { ok: true; service: SupabaseClient; userId: string; staff: AccessRow }
  | { ok: false; res: NextResponse }

/** Shared plumbing: resolve the caller's staff row, then apply `allow`. */
async function guard(allow: (row: AccessRow) => boolean): Promise<Guarded> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const service = createServiceClient()
  const { data: me } = await service
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (!me || !allow(me)) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, service, userId: user.id, staff: me }
}

/** Full admin (OP) only — staff management, customers, rewards, audit. */
export function requireOwner(): Promise<Guarded> {
  return guard(isOp)
}

/** Menu surfaces: OP, plus the general manager who is trusted with the menu
 *  without holding full admin rights. */
export function requireMenuEditor(): Promise<Guarded> {
  return guard(canEditMenu)
}
