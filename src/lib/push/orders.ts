// Tells the staff about what a CUSTOMER did at a table: connected a phone, sent an order, asked for a waiter.
// Server-only; called after the response by the customer routes (afterResponse, lib/server/after.ts), so a slow
// push service can never slow — or fail — a customer's tap.
//
// ── WHO (changed 2026-10-15, migration 061) ──────────────────────────────
// THE TABLE'S WAITER FIRST. `waiter_table_holder()` names the person who linked the table (linking claims it);
// they get the push, and only they, so an order is one person's job rather than the whole floor's.
//   • No waiter on the table, or no device of theirs could be reached → everyone `waiter_call_recipient_staff_ids()`
//     names (057's roster rule: open shift + front-of-house title + on the schedule, once one is published).
//   • The table HAS a waiter and the request is still waiting after ESCALATION_SECONDS → the rest of the shift is
//     told too ("⏱ … who is free?"). A dead phone, a waiter in the kitchen, a tablet left on a table: the flow does
//     not stop. The same 90 seconds is when the SQL lets those people SEE the request (061).
//
// ── WHERE ────────────────────────────────────────────────────────────────
// One device-set per person, the POS in preference to the portal (orders-rules.ts holds the rule and the
// reasoning). WHAT: orders-rules.ts → build*Payload.
//
// Never throws. Without VAPID keys it does nothing (the POS's own polling still shows the request). This is
// best-effort by design: the request is in the database whether or not a phone buzzed.

import { createServiceClient } from '@/lib/supabase/server'
import { sendToOne, type Service } from './deliver'
import { ensureVapidConfigured } from './send'
import {
  ESCALATION_SECONDS, ORDER_PUSH_TTL_SECONDS,
  buildCallPayload, buildConnectedPayload, buildOrderPayload, chooseTargets, escalated,
  type CallAlert, type ConnectedAlert, type OrderAlert, type PushApp, type PushSub, type StaffPayload,
} from './orders-rules'

type Build = (app: PushApp) => StaffPayload

/** A `setof uuid` comes back as a list of ids (or of one-key objects, depending on the client). */
const idList = (raw: unknown, key: string): string[] =>
  (Array.isArray(raw) ? raw : [])
    .map((x) => (typeof x === 'string' ? x : (x as Record<string, unknown> | null)?.[key]))
    .filter((x): x is string => typeof x === 'string')

/** Push `build(app)` to each of these people on the device(s) the rule picks. Returns how many notifications went. */
export async function pushToPeople(service: Service, staffIds: string[], build: Build): Promise<number> {
  if (staffIds.length === 0) return 0
  const { data: rows } = await service
    .from('staff_push_subscriptions')
    .select('id, staff_id, endpoint, p256dh, auth, app, last_seen_at')
    .in('staff_id', staffIds)
  const byPerson = new Map<string, PushSub[]>()
  for (const row of (rows ?? []) as PushSub[]) byPerson.set(row.staff_id, [...(byPerson.get(row.staff_id) ?? []), row])

  const now = Date.now()
  let sent = 0
  for (const [, subs] of byPerson) {
    const { primary, fallback } = chooseTargets(subs, now)
    let delivered = await deliverAll(service, primary, build)
    // The preferred device(s) are unreachable: fall back rather than tell nobody.
    if (delivered === 0 && fallback.length > 0) delivered = await deliverAll(service, fallback, build)
    sent += delivered
  }
  return sent
}

async function deliverAll(service: Service, subs: PushSub[], build: Build): Promise<number> {
  const results = await Promise.all(
    subs.map((sub) => sendToOne(service, sub, build(sub.app), { ttlSeconds: ORDER_PUSH_TTL_SECONDS })),
  )
  return results.filter((r) => r.ok).length
}

export interface TableAlert {
  /** The table the customer is at. Null = unknown: everyone on shift is told. */
  tableId: string | null
  build: Build
  /** Asked once, after ESCALATION_SECONDS: is it STILL waiting? Omit for an alert that is only information. */
  stillWaiting?: () => Promise<boolean>
  /** Information for the table's own waiter and nobody else: if they cannot be reached, nobody is told. */
  holderOnly?: boolean
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The one routing function: the table's waiter, else the shift; then, if it is still waiting, the shift too. */
export async function alertTableStaff(alert: TableAlert): Promise<{ delivered: number; escalated: boolean }> {
  try {
    if (!ensureVapidConfigured()) return { delivered: 0, escalated: false }
    const service = createServiceClient()

    let holder: string | null = null
    if (alert.tableId) {
      const { data, error } = await service.rpc('waiter_table_holder', { p_table_id: alert.tableId })
      // 42883 / PGRST202 = migration 061 is not applied: carry on as 058 did (everyone on shift).
      if (error && error.code !== '42883' && error.code !== 'PGRST202') console.error('waiter_table_holder failed:', error.code, error.message)
      holder = typeof data === 'string' ? data : null
    }

    const { data: raw, error } = await service.rpc('waiter_call_recipient_staff_ids')
    if (error) console.error('waiter_call_recipient_staff_ids failed:', error.code, error.message)
    const everyone = idList(raw, 'waiter_call_recipient_staff_ids')

    let delivered = 0
    if (holder) delivered = await pushToPeople(service, [holder], alert.build)
    // A heads-up that is only for the table's own waiter is not worth waking the shift for.
    if (alert.holderOnly) return { delivered, escalated: false }
    // Nobody in particular, or the waiter's devices could not be reached: the shift.
    if (!holder || delivered === 0) {
      delivered += await pushToPeople(service, everyone.filter((id) => id !== holder), alert.build)
      return { delivered, escalated: false }
    }

    // The waiter has been told. If it is still waiting a minute and a half later, so is everybody else.
    if (!alert.stillWaiting) return { delivered, escalated: false }
    await sleep(ESCALATION_SECONDS * 1000)
    if (!(await alert.stillWaiting().catch(() => false))) return { delivered, escalated: false }
    const others = everyone.filter((id) => id !== holder)
    const more = await pushToPeople(service, others, (app) => escalated(alert.build(app), ESCALATION_SECONDS))
    return { delivered: delivered + more, escalated: true }
  } catch (err) {
    console.error('alertTableStaff failed:', err instanceof Error ? err.message : err)
    return { delivered: 0, escalated: false }
  }
}

// ── the three customer events ────────────────────────────────────────────

export async function notifyStaffOfSubmission(alert: OrderAlert & { tableId: string | null }) {
  return alertTableStaff({
    tableId: alert.tableId,
    build: (app) => buildOrderPayload(alert, app),
    stillWaiting: async () => {
      const { data } = await createServiceClient()
        .from('customer_cart_submissions').select('status').eq('id', alert.submissionId).maybeSingle()
      return (data as { status?: string } | null)?.status === 'pending'
    },
  })
}

export async function notifyStaffOfCall(alert: CallAlert & { tableId: string | null }) {
  return alertTableStaff({
    tableId: alert.tableId,
    build: (app) => buildCallPayload(alert, app),
    stillWaiting: async () => {
      const { data } = await createServiceClient()
        .from('waiter_table_calls').select('acknowledged_at').eq('id', alert.callId).maybeSingle()
      const row = data as { acknowledged_at?: string | null } | null
      return !!row && row.acknowledged_at == null
    },
  })
}

/** Information only: no escalation — nothing is waiting on a person. */
export async function notifyStaffOfConnection(alert: ConnectedAlert & { tableId: string | null }) {
  return alertTableStaff({ tableId: alert.tableId, build: (app) => buildConnectedPayload(alert, app), holderOnly: true })
}
