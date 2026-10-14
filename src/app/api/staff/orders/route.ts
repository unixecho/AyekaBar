import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/staff/guard'

// What is waiting for a waiter, for the portal's "orders waiting" card (the other half of the POS's review
// queue — a staff member who works from the saved portal instead of the POS still needs to SEE that a customer
// sent something). Built 2026-10-13 (migration 058).
//
// WHO MAY SEE IT is decided in Postgres, not here: `waiter_pending_submissions()` returns nothing at all unless
// the SIGNED-IN person passes the same rule that decides who is told about a waiter call (an open shift, a
// front-of-house title, and — once a schedule is published — being assigned to a shift covering now). That is
// why this calls it as the USER (the cookie-bound client, so `auth.uid()` is the caller) and not through the
// service role, which would answer for nobody in particular. `requireStaff()` is the cheap first gate.
//
// WHAT LEAVES: counts, the table and the time. Never the payload — no diner names, no notes. The review itself
// happens in the POS, which shows the lines and re-prices them; this card only says "go and look".
//
// Fails QUIET: before migration 058 is applied the function does not exist; the answer is an empty list, not an
// error, so the card simply is not there.

export const dynamic = 'force-dynamic'

interface PendingRow { id: string; table_number: number | null; created_at: string; item_count: number; total_agorot: number; payload: { items?: { qty?: number }[] } | null }

export async function GET() {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  const { data, error } = await createClient().rpc('waiter_pending_submissions')
  const noStore = { headers: { 'Cache-Control': 'no-store' } }
  if (error) return NextResponse.json({ orders: [] }, noStore)

  const orders = ((Array.isArray(data) ? data : []) as PendingRow[]).map((r) => ({
    id: r.id,
    tableNumber: r.table_number,
    // Quantity, not lines — "4 drinks" is what a waiter's eye wants.
    itemCount: Array.isArray(r.payload?.items)
      ? r.payload!.items!.reduce((n, i) => n + (Number.isFinite(i?.qty) ? Number(i.qty) : 0), 0)
      : r.item_count,
    totalAgorot: r.total_agorot,
    createdAt: r.created_at,
  }))
  return NextResponse.json({ orders }, noStore)
}
