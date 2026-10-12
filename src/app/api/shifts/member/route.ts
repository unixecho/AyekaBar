import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { apiRoute, BadRequest, NotFound } from '@/lib/http/errors'
import { performDispatch } from '@/lib/shifts/dispatch-write'
import { getActiveVenue } from '@/lib/shifts/guard'

// A dedicated write for the staff list on /owner/dashboard (StaffManager): it flips one person's
// "on the schedule" switch and has no <ShiftsProvider> and no week in view, so it cannot go through
// /api/shifts/dispatch's draft flow. It performs the exact same `setMember` action through the exact
// same performDispatch() — one write path, not two — so the guard, the database function and the
// audit row are the ones every schedule screen uses.
const body = z.object({ staffId: z.string().uuid(), schedulable: z.boolean() }).strict()

export const dynamic = 'force-dynamic'

export const POST = apiRoute(async (request: NextRequest) => {
  const input = body.parse(await request.json().catch(() => null))
  const venue = await getActiveVenue()
  if (!venue) throw NotFound('Venue not found.')
  if (!input.staffId) throw BadRequest()
  await performDispatch({ type: 'setMember', venueId: venue.id, staffId: input.staffId, patch: { schedulable: input.schedulable } })
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
})
