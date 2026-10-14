// One Web Push delivery, shared by everything that pushes to a staff phone (the schedule alerts in
// staff.ts, the customer-order alerts in orders.ts). It exists so that "what happens to a
// subscription the push service says is gone" is written ONCE: a 404/410 means this phone's
// subscription is permanently dead (app removed, permission revoked), and it is deleted so no one
// ever tries it again. Any other failure is logged and reported, never thrown — a push problem must
// not fail the request it rides on.

import webpush from 'web-push'
import { createServiceClient } from '@/lib/supabase/server'

export type Service = ReturnType<typeof createServiceClient>

export type SubscriptionRow = { id: string; staff_id: string; endpoint: string; p256dh: string; auth: string }

export type SendOutcome = { ok: boolean; statusCode: number | null; detail: string }

/** A shift alert is useless hours later; an order request is useless a few minutes later
 *  (orders.ts passes its own, shorter TTL). */
const DEFAULT_TTL_SECONDS = 60 * 60 * 3

export async function sendToOne(
  service: Service,
  row: SubscriptionRow,
  payload: object,
  options: { ttlSeconds?: number } = {},
): Promise<SendOutcome> {
  try {
    await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), {
      urgency: 'high',
      TTL: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    })
    return { ok: true, statusCode: null, detail: '' }
  } catch (err) {
    const failure = err as { statusCode?: number; body?: string; message?: string } | null
    const statusCode = failure?.statusCode ?? null
    const detail = failure?.body || failure?.message || String(err)
    // 404/410: this phone's subscription is permanently gone (app removed, permission revoked).
    if (statusCode === 404 || statusCode === 410) await service.from('staff_push_subscriptions').delete().eq('id', row.id)
    else console.error('Staff push failed:', statusCode, detail)
    return { ok: false, statusCode, detail }
  }
}
