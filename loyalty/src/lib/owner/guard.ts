import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Gate an owner-only API route: returns a service-role client if the caller
 *  is a signed-in owner, otherwise a 401/403 response to return directly. */
export async function requireOwner(): Promise<
  | { ok: true; service: SupabaseClient; userId: string }
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
