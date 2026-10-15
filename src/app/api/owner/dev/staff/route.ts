import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireDev } from '@/lib/owner/guard'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { revokeJoin } from '@/lib/staff/join-server'
import {
  HARD_DELETE_MESSAGES, HARD_DELETE_STATUS, hardDeleteDone, hardDeleteRefusal, isForeignKeyViolation, tombstonePatch,
  type HardDeleteMode,
} from '@/lib/staff/hard-delete'

// Permanently deleting a person — the DEVELOPER'S power (owner, 2026-10-15: "give the dev an option to hard delete
// users so managers can only deactivate"). The managers' route (DELETE /api/owner/staff) only ever deactivates.
//
// Why this is its own route and not a flag on that one: a flag is one forgotten check away from reaching the people it
// was never meant for. Here the guard is `requireDev` (an admin row carrying the Dev badge) and nothing else, the same
// reasoning as /api/owner/dev/flags.
//
// The rules (who may be deleted, what is kept) are pure and tested — lib/staff/hard-delete.ts. In short: only someone
// ALREADY deactivated, never yourself, never an owner, never someone with payslips; their login and loyalty profile
// are deleted; the roster row is deleted if nothing references it, otherwise it is kept as an anonymous tombstone so
// the till history stays whole.

type Body = { id?: unknown }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const auth = await requireDev()
  if (!auth.ok) return auth.res

  if (!(await checkRateLimit(`dev-hard-delete:${auth.userId}`, 20, 600))) return rateLimitResponse()

  const body = (await request.json().catch(() => null)) as Body | null
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const { service } = auth
  const { data: row } = await service
    .from('staff').select('id, auth_user_id, role, active').eq('id', id).maybeSingle()

  // Payslips are an ON DELETE RESTRICT: count them first so the answer is a sentence, not a constraint error. If the
  // table does not exist (migration 060 not applied) there is nothing to protect.
  let payslips = 0
  const ps = await service.from('staff_payslips').select('id').eq('staff_id', id).limit(1)
  if (!ps.error) payslips = ps.data?.length ?? 0

  const refusal = hardDeleteRefusal(row, { actorAuthUserId: auth.userId, payslips })
  if (refusal) return NextResponse.json({ error: HARD_DELETE_MESSAGES[refusal], reason: refusal }, { status: HARD_DELETE_STATUS[refusal] })
  const authUserId = row!.auth_user_id // a deactivated person has none (the soft delete clears it) — kept for a row restored by hand

  // Things that would otherwise linger: open swap/request rows are cleaned by the scheduler's own function (it also
  // removes their future shifts, which would otherwise be left as empty seats), join links and push devices are
  // personal. All best-effort — none of them may block the delete.
  const { data: actor } = await service.from('staff').select('id').eq('auth_user_id', auth.userId).maybeSingle()
  if (actor?.id) {
    await service.rpc('sched_set_staff_active', { p_actor: actor.id, p_staff: id, p_active: false, p_remove_future: true })
  }
  await revokeJoin(service, id)
  await service.from('staff_push_subscriptions').delete().eq('staff_id', id)

  let mode: HardDeleteMode = 'deleted'
  const del = await service.from('staff').delete().eq('id', id)
  if (del.error) {
    if (!isForeignKeyViolation(del.error)) {
      console.error('hard delete staff failed:', del.error.code, String(del.error.message ?? '').slice(0, 200))
      return NextResponse.json({ error: 'המחיקה נכשלה' }, { status: 500 })
    }
    // Orders / events still point at this row: keep it, with nothing personal on it.
    mode = 'anonymized'
    await service.from('shift_availability').delete().eq('staff_id', id) // their private messages to the manager
    const upd = await service.from('staff').update(tombstonePatch()).eq('id', id)
    if (upd.error) {
      console.error('hard delete (anonymise) failed:', upd.error.code, String(upd.error.message ?? '').slice(0, 200))
      return NextResponse.json({ error: 'המחיקה נכשלה' }, { status: 500 })
    }
  }

  // The login itself, and the loyalty profile that cascades from it. Their absence from our auth system is what lets the
  // same Google address start fresh. It can be refused when that account authored other records (menu publishes, point
  // adjustments) — then the roster side is already gone, which is reported plainly.
  let authDeleted = true
  if (authUserId) {
    const { error } = await service.auth.admin.deleteUser(authUserId)
    if (error) { authDeleted = false; console.error('hard delete: auth user kept:', String(error.message ?? '').slice(0, 200)) }
  }

  revalidatePath('/team')
  return NextResponse.json({ ok: true, mode, authDeleted, message: hardDeleteDone(mode, authDeleted) })
}
