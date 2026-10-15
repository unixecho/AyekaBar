// The pure rules behind "a customer sent an order": WHICH of a person's devices is told, and what the
// alert says. No server-only imports on purpose, so scripts/check-remote-ordering.mjs runs the real code.
//
// ── THE OWNER'S RULE (2026-10-13) ────────────────────────────────────
//   "Staff registered to the shift get a push update with vibration and a ding, to either the main
//    saved site or the OMS. If both are logged in, the system chooses the OMS app."
//
// A person can be subscribed in two places: the portal's service worker (`app = 'portal'`, the "main
// saved site") and the POS's (`app = 'oms'`, staff.ayeka.bar). Sending to both would buzz the same
// phone twice, so ONE is chosen per person:
//
//   1. a FRESH OMS subscription  → the OMS (all of that person's fresh OMS devices);
//   2. otherwise                 → the portal;
//   3. otherwise                 → a stale OMS one (better than telling nobody).
//
// "Logged in on the POS" is `last_seen_at`: the POS re-registers its subscription every time it opens
// (waiter_register_push, migration 058) and unregisters on sign-out, so a row that is fresh is a POS
// someone is using. 24 hours covers a long shift plus the night before without a stale tablet from last
// week winning. If every delivery to the chosen device(s) FAILS, the portal subscriptions are tried —
// a failed delivery is the one honest signal that the preferred device is not reachable.
//
// The rule is TypeScript-only (the database just stores `app` and `last_seen_at`), so there is no SQL
// twin to drift out of step with.

export const OMS_PUSH_FRESH_HOURS = 24

/** An order request is stale within minutes — a waiter who sees it an hour late is worse than not
 *  seeing it (a customer is still waiting). The push service drops it after this long. */
export const ORDER_PUSH_TTL_SECONDS = 15 * 60

/** Android buzzes in this pattern; iOS ignores `vibrate` (the OS notification sound is the signal there,
 *  and an open POS screen plays its own ding — see ayeka-staff's CustomerOrders). */
export const ORDER_VIBRATION: readonly number[] = [320, 110, 320, 110, 520]

export type PushApp = 'portal' | 'oms'

export interface PushSub {
  id: string
  staff_id: string
  endpoint: string
  p256dh: string
  auth: string
  app: PushApp
  last_seen_at: string
}

export interface Targets {
  /** Tried first, all at once. */
  primary: PushSub[]
  /** Tried ONLY if every primary delivery failed. */
  fallback: PushSub[]
}

const FRESH_MS = OMS_PUSH_FRESH_HOURS * 60 * 60 * 1000

/** Which devices of ONE person hear about it. `nowMs` is a parameter so the harness can pin the clock. */
export function chooseTargets(subs: PushSub[], nowMs: number): Targets {
  // A timestamp that does not parse is treated as stale: NaN fails every comparison.
  const isFresh = (s: PushSub) => nowMs - Date.parse(s.last_seen_at) <= FRESH_MS
  const oms = subs.filter((s) => s.app === 'oms')
  const freshOms = oms.filter(isFresh)
  const portal = subs.filter((s) => s.app === 'portal')

  if (freshOms.length > 0) return { primary: freshOms, fallback: portal }
  if (portal.length > 0) return { primary: portal, fallback: [] }
  return { primary: oms, fallback: [] }
}

export interface OrderAlert {
  submissionId: string
  tableNumber: number | null
  /** Total quantity across lines — "4 drinks", not "2 lines". */
  itemCount: number
  totalAgorot: number
}

const shekel = (agorot: number): string => {
  const v = Math.max(0, agorot) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

export type StaffAlertKind = 'table-order' | 'table-call' | 'table-connected' | 'items-ready' | 'items-sent'

/** What every staff alert looks like on the wire (both service workers validate it as DATA). */
export interface StaffPayload {
  kind: StaffAlertKind
  title: string
  body: string
  /** A same-origin path. The POS opens its own home (the review queue is there); the portal opens the
   *  staff dashboard, whose card lists what is waiting. */
  url: string
  /** The same request never stacks two notifications in the tray. */
  tag: string
  vibrate: number[]
  /** Stays on screen until dealt with, where the platform allows it. */
  urgent: boolean
}

export type OrderPayload = StaffPayload & { kind: 'table-order'; urgent: true }

/** How long a request may wait for the table's own waiter before the rest of the shift is told as well.
 *  ⚠️ SPELLED TWICE: migration 061's waiter_staff_can_handle_table() lets the other waiters SEE a request
 *  after the same 90 seconds. scripts/check-remote-ordering.mjs pins the two together. */
export const ESCALATION_SECONDS = 90

const url = (app: PushApp) => (app === 'oms' ? '/' : '/staff/dashboard')

export function buildOrderPayload(alert: OrderAlert, app: PushApp): OrderPayload {
  const table = alert.tableNumber ?? '?'
  const items = Math.max(0, Math.round(alert.itemCount))
  return {
    kind: 'table-order',
    title: `שולחן ${table} שלח הזמנה`,
    body: `${items} פריטים · ₪${shekel(alert.totalAgorot)} · ממתין לאישור`,
    url: url(app),
    tag: `table-order-${alert.submissionId}`,
    vibrate: [...ORDER_VIBRATION],
    urgent: true,
  }
}

export type CallKind = 'waiter' | 'bill' | 'assistance'

export interface CallAlert {
  callId: string
  tableNumber: number | null
  kind: CallKind
  /** Lines in the customer's cart when they called — counts only. */
  cartItems: number
}

const CALL_TITLE: Record<CallKind, string> = {
  waiter: 'קורא למלצר',
  bill: 'מבקש את החשבון',
  assistance: 'מבקש עזרה',
}

/** A customer asked for a waiter / the bill / help. Stays on screen: a person is waving. */
export function buildCallPayload(alert: CallAlert, app: PushApp): StaffPayload {
  const table = alert.tableNumber ?? '?'
  const kind: CallKind = alert.kind in CALL_TITLE ? alert.kind : 'waiter'
  const cart = Math.max(0, Math.round(alert.cartItems))
  return {
    kind: 'table-call',
    title: `שולחן ${table} ${CALL_TITLE[kind]}`,
    body: cart > 0 ? `יש גם הזמנה בעגלה (${cart} פריטים) · ממתין לך` : 'ממתין לך',
    url: url(app),
    tag: `table-call-${alert.callId}`,
    vibrate: [...ORDER_VIBRATION],
    urgent: true,
  }
}

export interface ConnectedAlert {
  tableNumber: number | null
  /** Phones connected to the visit right now, when known. */
  devices?: number
}

/** Customers connected to a table the waiter linked: a short heads-up, not an alarm. */
export function buildConnectedPayload(alert: ConnectedAlert, app: PushApp): StaffPayload {
  const table = alert.tableNumber ?? '?'
  return {
    kind: 'table-connected',
    title: `הלקוחות התחברו לשולחן ${table}`,
    body: 'הזמנות שיישלחו משם יגיעו אליך לאישור',
    url: url(app),
    // One notification per table: a second phone joining replaces it rather than stacking.
    tag: `table-connected-${table}`,
    vibrate: [140, 70, 140],
    urgent: false,
  }
}

/** The same alert, said again to the rest of the shift because the table's own waiter has not taken it. */
export function escalated(payload: StaffPayload, waitedSeconds: number): StaffPayload {
  const mins = waitedSeconds >= 120 ? `${Math.round(waitedSeconds / 60)} דקות` : `${Math.max(1, Math.round(waitedSeconds))} שניות`
  return {
    ...payload,
    title: `⏱ ${payload.title}`,
    body: `ממתין כבר ${mins} — מי פנוי? · ${payload.body}`,
    tag: `${payload.tag}-escalated`,
    urgent: true,
  }
}

/** Items a bartender / cook just marked ready — for the waiter who owns the table. */
export interface ReadyAlert { orderId: string; tableLabel: string; itemNames: string[]; station: 'bar' | 'kitchen' | null }

export function buildReadyPayload(alert: ReadyAlert, app: PushApp): StaffPayload {
  const names = alert.itemNames.slice(0, 3).join(', ')
  const more = alert.itemNames.length > 3 ? ` +${alert.itemNames.length - 3}` : ''
  return {
    kind: 'items-ready',
    title: `שולחן ${alert.tableLabel} · מוכן לאיסוף`,
    body: `${names}${more}`.trim() || 'פריטים מוכנים',
    url: url(app),
    tag: `items-ready-${alert.orderId}`,
    vibrate: [...ORDER_VIBRATION],
    urgent: true,
  }
}

/** A waiter sent items to a station — for the people working that station. */
export interface SentAlert { orderId: string; batchNo: number; tableLabel: string; station: 'bar' | 'kitchen'; itemCount: number }

export function buildSentPayload(alert: SentAlert, app: PushApp): StaffPayload {
  const where = alert.station === 'bar' ? 'בר' : 'מטבח'
  return {
    kind: 'items-sent',
    title: `${where} · הזמנה חדשה משולחן ${alert.tableLabel}`,
    body: `${Math.max(1, Math.round(alert.itemCount))} פריטים`,
    url: url(app),
    tag: `items-sent-${alert.orderId}-${alert.batchNo}-${alert.station}`,
    vibrate: [200, 80, 200],
    urgent: true,
  }
}
