import { createClient } from '@/lib/supabase/server'

// Server-only, like lib/menu/fetch.ts. Reads the narrow public_staff view
// (migration 011) — never public.staff, which carries emails and auth ids.

export interface TeamMember {
  id: string
  firstName: string
  lastName: string | null
  badge: string | null
  role: string
  photoUrl: string | null
  displayOrder: number | null
}

interface PublicStaffRow {
  id: string
  first_name: string | null
  last_name: string | null
  badge: string | null
  role: string
  photo_url: string | null
  display_order: number | null
}

/** Owners first, then the owner's manual order, then alphabetical — so the
 *  page has a sensible shape before anyone touches display_order. */
function rank(row: PublicStaffRow): [number, number, string] {
  return [
    row.role === 'owner' ? 0 : 1,
    row.display_order ?? Number.MAX_SAFE_INTEGER,
    (row.first_name ?? '').toLocaleLowerCase('he'),
  ]
}

export async function fetchTeam(): Promise<TeamMember[]> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('public_staff')
    .select('id, first_name, last_name, badge, role, photo_url, display_order')

  // The team page is decoration, not a critical surface — if the view is
  // missing (migration 011 not applied yet) render nothing rather than 500.
  if (error || !data) return []

  const rows = data as PublicStaffRow[]

  return rows
    .filter((r) => r.first_name)
    .sort((a, b) => {
      const [ar, ao, an] = rank(a)
      const [br, bo, bn] = rank(b)
      return ar - br || ao - bo || an.localeCompare(bn, 'he')
    })
    .map((r) => ({
      id: r.id,
      firstName: r.first_name as string,
      lastName: r.last_name,
      badge: r.badge,
      role: r.role,
      photoUrl: r.photo_url,
      displayOrder: r.display_order,
    }))
}
