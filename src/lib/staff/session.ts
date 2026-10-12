import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isStaff, type AccessRow } from '@/lib/staff/access'

/** The signed-in person as the scheduling code needs to know them. Always resolved from the session
 *  (never from a request body) and always an ACTIVE staff row — a removed person has had their
 *  auth_user_id cleared, so this finds nobody for them. */
export type StaffIdentity = AccessRow & {
  id: string
  auth_user_id: string | null
  email: string | null
  display_name: string | null
  first_name: string | null
  last_name: string | null
  active: boolean
}

export type StaffRow = StaffIdentity

const STAFF_COLUMNS = 'id, auth_user_id, role, badge, active, email, display_name, first_name, last_name'

/** Who is calling: the Google session's staff row, or null (signed out, not on the roster, or removed). */
export async function resolveStaffIdentity(): Promise<StaffIdentity | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await createServiceClient().from('staff').select(STAFF_COLUMNS).eq('auth_user_id', user.id).eq('active', true).maybeSingle()
  return isStaff(data) ? (data as StaffIdentity) : null
}
