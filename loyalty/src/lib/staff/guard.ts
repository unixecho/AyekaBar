import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Gate a staff-only API route: returns a service-role client if the caller is
 *  a signed-in member of `public.staff` (owners included), otherwise a 401/403
 *  to return directly.
 *
 *  Being signed in with Google is NOT being staff — anyone with a Google
 *  account can authenticate against this project. Every route that acts with
 *  staff authority must call this, not just `getUser()`. */
export async function requireStaff(): Promise<
  | { ok: true; service: SupabaseClient; userId: string; role: string }
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

  if (!me) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, service, userId: user.id, role: me.role }
}
