import { NextResponse } from 'next/server'
import { requireMenuEditor } from '@/lib/owner/guard'

// DEMO-ONLY as of PLAN_SHIFTS.md Part II (2026-08-20). This route served the
// prototype's assignment picker before migration 027 existed; the live
// source now reads the roster through `schedule_roster` — see
// src/lib/shifts/state-query.ts and GET /api/shifts/roster — which carries
// each person's real `schedulable` state, something this route never had.
// Kept, unchanged, because `MockShiftsSource` (mock.ts) still calls it for
// the `?demo=1` prototype path, so removing it would break the demo rather
// than the live app. Do not point any new live surface at this route.
//
// Original rationale, still accurate for the demo path: `public.staff` RLS
// lets a signed-in user read only their OWN row, so the mock builder cannot
// read who else is on the team via the browser's own session — the same
// problem migration 025's `waiter_staff_directory` view solved for the floor
// map. Gated with `requireMenuEditor` (OP or general manager) since that
// predates `is_schedule_manager()` existing at all.
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
