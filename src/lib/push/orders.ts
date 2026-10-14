// Tells the staff on shift that a customer sent an order. Server-only; called after the response by
// POST /api/table/order (afterResponse, lib/server/after.ts), so a slow push service can never slow —
// or fail — a customer's "send".
//
// WHO: `waiter_call_recipient_staff_ids()` (migration 058) — the same rule that decides who is told
// about a waiter call (057): an open shift, a front-of-house title, and — once a schedule is published —
// assigned to a shift that covers now. The database decides; this file asks.
// WHERE: one device-set per person, the POS in preference to the portal (orders-rules.ts holds the rule
// and the reasoning). WHAT: orders-rules.ts → buildOrderPayload.
//
// Never throws. Without VAPID keys it does nothing (the POS's own polling still shows the order).
// This is best-effort by design: the pending request is in the database whether or not a phone buzzed.

import { createServiceClient } from '@/lib/supabase/server'
import { sendToOne, type Service } from './deliver'
import { ensureVapidConfigured } from './send'
import {
  ORDER_PUSH_TTL_SECONDS, buildOrderPayload, chooseTargets,
  type OrderAlert, type PushSub,
} from './orders-rules'

export async function notifyStaffOfSubmission(alert: OrderAlert): Promise<{ recipients: number; sent: number }> {
  try {
    if (!ensureVapidConfigured()) return { recipients: 0, sent: 0 }
    const service = createServiceClient()

    const { data: raw, error } = await service.rpc('waiter_call_recipient_staff_ids')
    if (error) {
      // 42883 = migration 058 is not applied. The request is still in the database; the POS polls it.
      console.error('waiter_call_recipient_staff_ids failed:', error.code, error.message)
      return { recipients: 0, sent: 0 }
    }
    // A `setof uuid` comes back as a list of ids (or of one-key objects, depending on the client).
    const staffIds = (Array.isArray(raw) ? raw : [])
      .map((x) => (typeof x === 'string' ? x : (x as Record<string, unknown> | null)?.waiter_call_recipient_staff_ids))
      .filter((x): x is string => typeof x === 'string')
    if (staffIds.length === 0) return { recipients: 0, sent: 0 }

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
      let delivered = await deliverAll(service, primary, alert)
      // The preferred device(s) are unreachable: fall back rather than tell nobody.
      if (delivered === 0 && fallback.length > 0) delivered = await deliverAll(service, fallback, alert)
      sent += delivered
    }
    return { recipients: staffIds.length, sent }
  } catch (err) {
    console.error('notifyStaffOfSubmission failed:', err instanceof Error ? err.message : err)
    return { recipients: 0, sent: 0 }
  }
}

async function deliverAll(service: Service, subs: PushSub[], alert: OrderAlert): Promise<number> {
  const results = await Promise.all(
    subs.map((sub) => sendToOne(service, sub, buildOrderPayload(alert, sub.app), { ttlSeconds: ORDER_PUSH_TTL_SECONDS })),
  )
  return results.filter((r) => r.ok).length
}
