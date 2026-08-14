import { NextResponse } from 'next/server'
import { requireMenuEditor } from '@/lib/owner/guard'

// The real roster, for the shift-scheduling prototype's assignment picker.
//
// `public.staff` RLS lets a signed-in user read only their OWN row (by
// design — emails and roles are not a colleague's business), so the
// schedule builder cannot read who else is on the team via the browser's
// own session, the same problem migration 025's `waiter_staff_directory`
// view solved for the floor map. This route is the API-route equivalent of
// that view: a service-role read, gated, returning only display-safe fields.
//
// Gated with `requireMenuEditor` (OP or general manager) rather than a
// dedicated schedule guard: `canManageSchedule()`'s extra per-person
// delegation clause lives in `shift_settings.schedule_managers`, a table
// that does not exist until migration 027 is applied (see
// src/lib/shifts/guard.ts). Until then OP-or-GM *is* the complete rule, not
// an approximation of it — this route stays correct as written and gets no
// less permissive when 027 lands, only more so.
export async function GET() {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('staff')
    .select('id, display_name, first_name, last_name, email, badge, role, colour, initial, auth_user_id')
    .order('display_name', { ascending: true, nullsFirst: false })

  if (error) return NextResponse.json({ error: 'טעינת הצוות נכשלה' }, { status: 500 })

  const staff = (data ?? []).map((s) => ({
    id: s.id as string,
    name: s.display_name?.trim()
      || [s.first_name, s.last_name].filter(Boolean).join(' ').trim()
      || s.email
      || '—',
    initial: (s.initial as string | null) ?? null,
    colour: (s.colour as string | null) ?? null,
    badge: (s.badge as string | null) ?? null,
    role: s.role as string,
    // public.staff has no soft-delete flag — a removed person is a deleted
    // row, not a disabled one, so anyone this query returns is active by
    // definition. A pending invite (auth_user_id null) is kept in rather
    // than filtered out: hiding someone the owner already authorized, just
    // because they have not signed in yet, is how a manager ends up unable
    // to schedule a new hire before their first shift.
    active: true,
    pending: !s.auth_user_id,
  }))

  return NextResponse.json({ staff })
}
