// Pushes for what STAFF do in the POS (staff.ayeka.bar) — the other half of "every event that needs a push gets
// one" (2026-10-15). The customer events live in orders.ts; these are the two the kitchen floor runs on:
//
//   items-ready  a bartender or cook marked items ready  → the WAITER who looks after that table
//   items-sent   a waiter sent items to a station        → the people CHECKED IN at that station
//
// ── WHY THE SERVER DECIDES WHO, AND WHAT, FROM THE DATABASE ──────────────
// The POS cannot be trusted to name recipients (it is the one place a staff member's own browser could be made to
// say anything). So the request carries only ids — an order, some items, a batch — and this file reads the truth:
// the items must really be `ready` (or `sent`) and recent, the order must still be open, and the recipients come
// from the table's holder, the order's waiter and the station check-ins. A caller can at worst re-send an alert
// about something that really just happened — and the route rate-limits that.
//
// Never throws; best-effort by design — the in-app overlay and the POS's own polling are still there.

import { createServiceClient } from '@/lib/supabase/server'
import { pushToPeople } from './orders'
import { buildReadyPayload, buildSentPayload } from './orders-rules'
import { ensureVapidConfigured } from './send'

type Service = ReturnType<typeof createServiceClient>

/** "Just happened" — an alert about something older than this is a replay, not news. */
export const EVENT_FRESH_MS = 5 * 60_000

const fresh = (iso: string | null | undefined) => !!iso && Date.now() - Date.parse(iso) <= EVENT_FRESH_MS
const idList = (raw: unknown, key: string): string[] =>
  (Array.isArray(raw) ? raw : [])
    .map((x) => (typeof x === 'string' ? x : (x as Record<string, unknown> | null)?.[key]))
    .filter((x): x is string => typeof x === 'string')

interface OrderRow { id: string; table_id: string | null; table_number: number | null; table_label: string | null; waiter_staff_id: string | null; status: string }

async function openOrder(service: Service, orderId: string): Promise<OrderRow | null> {
  const { data } = await service
    .from('waiter_orders').select('id, table_id, table_number, table_label, waiter_staff_id, status').eq('id', orderId).maybeSingle()
  const row = data as OrderRow | null
  return row && (row.status === 'open' || row.status === 'filed') ? row : null
}

const labelOf = (o: OrderRow) => String(o.table_label ?? o.table_number ?? '?')

/** Who looks after this order's table: its holder, else the order's own waiter, else the shift (057's rule). */
async function waitersFor(service: Service, order: OrderRow): Promise<string[]> {
  if (order.table_id) {
    const { data, error } = await service.rpc('waiter_table_holder', { p_table_id: order.table_id })
    if (!error && typeof data === 'string') return [data]
  }
  if (order.waiter_staff_id) {
    const { data } = await service.from('staff').select('id').eq('id', order.waiter_staff_id).eq('active', true).not('auth_user_id', 'is', null).maybeSingle()
    if (data) return [order.waiter_staff_id]
  }
  const { data } = await service.rpc('waiter_call_recipient_staff_ids')
  return idList(data, 'waiter_call_recipient_staff_ids')
}

export async function notifyItemsReady(orderId: string, itemIds: string[]): Promise<{ sent: number }> {
  try {
    if (!ensureVapidConfigured() || itemIds.length === 0) return { sent: 0 }
    const service = createServiceClient()
    const order = await openOrder(service, orderId)
    if (!order) return { sent: 0 }
    // Everything on the order that is ready right now — not only the item that triggered this ping. A bartender marks
    // four drinks ready in four taps; the waiter should read "4 drinks", not just whichever came last (the tag makes
    // each new alert REPLACE the previous one in the tray, so the last must say it all).
    const { data } = await service
      .from('waiter_order_items').select('id, name_he, qty, status, ready_at, station').eq('order_id', orderId).eq('status', 'ready')
    const readyAll = ((data ?? []) as { id: string; name_he: string; qty: number; status: string; ready_at: string | null; station: string | null }[])
      .filter((i) => fresh(i.ready_at))
    // The ids the caller named must be among them: a ping about nothing that really just happened sends nothing.
    const named = new Set(itemIds)
    if (!readyAll.some((i) => named.has(i.id))) return { sent: 0 }
    const ready = readyAll

    const people = await waitersFor(service, order)
    const names = ready.map((i) => (i.qty > 1 ? `${i.qty}× ${i.name_he}` : i.name_he))
    const station = ready[0].station === 'bar' || ready[0].station === 'kitchen' ? ready[0].station : null
    const sent = await pushToPeople(service, people, (app) => buildReadyPayload({ orderId, tableLabel: labelOf(order), itemNames: names, station }, app))
    return { sent }
  } catch (err) {
    console.error('notifyItemsReady failed:', err instanceof Error ? err.message : err)
    return { sent: 0 }
  }
}

export async function notifyItemsSent(orderId: string, batchNo: number): Promise<{ sent: number }> {
  try {
    if (!ensureVapidConfigured()) return { sent: 0 }
    const service = createServiceClient()
    const order = await openOrder(service, orderId)
    if (!order) return { sent: 0 }
    const { data } = await service
      .from('waiter_order_items').select('id, qty, status, sent_at, station').eq('order_id', orderId).eq('batch_no', batchNo)
    const rows = ((data ?? []) as { id: string; qty: number; status: string; sent_at: string | null; station: string | null }[])
      .filter((i) => i.status === 'sent' && fresh(i.sent_at) && (i.station === 'bar' || i.station === 'kitchen'))
    if (rows.length === 0) return { sent: 0 }

    // Who is working each station right now: the latest check-in/out of each person in the OPEN shift.
    const { data: shift } = await service.from('waiter_shift_sessions').select('id').eq('status', 'active').limit(1).maybeSingle()
    const shiftId = (shift as { id?: string } | null)?.id
    if (!shiftId) return { sent: 0 }
    const { data: checks } = await service
      .from('waiter_station_checkins').select('staff_id, station, event, at').eq('shift_session_id', shiftId).order('at', { ascending: true })
    const latest = new Map<string, string>()   // `${station}:${staff}` → last event
    for (const c of (checks ?? []) as { staff_id: string; station: string; event: string }[]) latest.set(`${c.station}:${c.staff_id}`, c.event)

    let sent = 0
    for (const station of ['bar', 'kitchen'] as const) {
      const here = rows.filter((r) => r.station === station)
      if (here.length === 0) continue
      const people = [...latest.entries()]
        .filter(([key, event]) => key.startsWith(`${station}:`) && event === 'check_in')
        .map(([key]) => key.slice(station.length + 1))
      const count = here.reduce((n, r) => n + r.qty, 0)
      sent += await pushToPeople(service, people, (app) => buildSentPayload({ orderId, batchNo, tableLabel: labelOf(order), station, itemCount: count }, app))
    }
    return { sent }
  } catch (err) {
    console.error('notifyItemsSent failed:', err instanceof Error ? err.message : err)
    return { sent: 0 }
  }
}
