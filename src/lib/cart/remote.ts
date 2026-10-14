// REMOTE ORDERING — the customer-facing half, PURE (no React, no DOM, no Supabase).
// Built 2026-10-13 (PLAN_MENU_CART.md §12), shipped OFF behind `table_ordering_enabled`.
//
// THE FLOW. A waiter on shift taps "הזמנה מרחוק" on a table in the POS and reads a
// six-digit code to the customer. The customer types it into their cart
// (POST /api/table/session) and becomes a DEVICE in that table's VISIT; the cart's
// "שליחה למלצר" then POSTs the open round (POST /api/table/order), which lands as a
// PENDING REQUEST that a waiter reviews and imports in the POS. Nothing the
// customer taps is ever an order by itself (submission.ts says why).
//
// RECOVERY. The same six digits work again — a new phone, a cleared cookie, a
// second person at the table — until staff end the visit or three hours pass
// (migration 058). The phone's right to order is an httpOnly cookie
// (`TABLE_SESSION_COOKIE`), so the page cannot read it: the only way the UI learns
// whether it is connected is GET /api/table/session, and that is why this file has
// a `SessionView` shape the route returns.
//
// WHAT THIS FILE IS NOT: it does not know about cookies being written, the database,
// or push. The routes (src/app/api/table/*) and lib/push/orders.ts do.

import type { Lang } from '../menu/types'
import { TABLE_CODE_LENGTH, isValidTableCodeShape, normalizeTableCode } from './otp'

// ── Input ────────────────────────────────────────────────────────────────

/** Errors the ROUTES can return, as codes — the client maps them to words
 *  (the menu is trilingual; the generic Hebrew-only helper is wrong here). */
export type RemoteError =
  | 'bad_request' | 'bad_code' | 'expired' | 'too_many_devices'     // redeeming
  | 'no_session' | 'ended' | 'no_shift'                              // a session that is not usable
  | 'too_many_pending' | 'too_fast' | 'empty'                        // sending
  | 'rate_limited' | 'disabled' | 'server'

export const REMOTE_ERROR_STATUS: Record<RemoteError, number> = {
  bad_request: 400,
  bad_code: 401,
  expired: 410,
  too_many_devices: 409,
  no_session: 401,
  ended: 410,
  no_shift: 409,
  too_many_pending: 409,
  too_fast: 429,
  empty: 400,
  rate_limited: 429,
  disabled: 403,
  server: 500,
}

/** The whole gate in front of the redeem endpoint's RPC. Strips what a person types
 *  around the digits (a space, a dash, a pasted "קוד: 123456") and demands exactly
 *  six — a malformed code is refused HERE, and never reaches the database or the
 *  failure counter (it is not a guess at a live code). */
export function validateRedeemInput(body: unknown): { ok: true; code: string } | { ok: false; error: RemoteError } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'bad_request' }
  const raw = (body as Record<string, unknown>).code
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 40) return { ok: false, error: 'bad_request' }
  const code = normalizeTableCode(raw)
  if (!isValidTableCodeShape(code)) return { ok: false, error: 'bad_code' }
  return { ok: true, code }
}

/** A session token as the cookie carries it: 32 random bytes, hex. Anything else
 *  is treated as "no session" without asking the database. */
export const isValidSessionToken = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t)

/** What the database says back from a redeem / lookup / create, mapped to the
 *  codes above. Anything we do not recognise is a server error, never a pass. */
export function remoteErrorFromReason(reason: string | null | undefined): RemoteError {
  switch (reason) {
    case 'bad_code': case 'expired': case 'too_many_devices':
    case 'no_session': case 'ended': case 'no_shift':
    case 'too_many_pending': case 'too_fast': case 'bad_request':
      return reason
    default:
      return 'server'
  }
}

// ── What GET /api/table/session returns ──────────────────────────────────

export type SubmissionState = 'pending' | 'imported' | 'rejected' | 'expired'

export interface SentRequest {
  id: string
  status: SubmissionState
  itemCount: number
  totalAgorot: number
  createdAt: string
}

/** The phone's view of its own connection. `connected: false` carries no detail on
 *  purpose — a prober learns nothing from why a cookie was refused. */
export type SessionView =
  | { connected: false }
  | {
      connected: true
      tableNumber: number
      /** When this phone's access ends (the visit's fixed end). */
      expiresAt: string
      /** False when the bar has no shift open: sending is refused until it does. */
      shiftOpen: boolean
      sent: SentRequest[]
    }

const STATES: readonly SubmissionState[] = ['pending', 'imported', 'rejected', 'expired']

/** Narrow whatever the server sent to the `SentRequest` list, dropping anything
 *  malformed rather than rendering it. The data came from our own route, but the
 *  client does not get to assume that. */
export function sanitizeSent(raw: unknown): SentRequest[] {
  if (!Array.isArray(raw)) return []
  const out: SentRequest[] = []
  for (const r of raw.slice(0, 20)) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.status !== 'string' || !(STATES as readonly string[]).includes(o.status)) continue
    const itemCount = Number(o.itemCount), totalAgorot = Number(o.totalAgorot)
    if (!Number.isFinite(itemCount) || !Number.isFinite(totalAgorot) || typeof o.createdAt !== 'string') continue
    out.push({ id: o.id, status: o.status as SubmissionState, itemCount, totalAgorot, createdAt: o.createdAt })
  }
  return out
}

// ── Words (customer-facing: all three languages) ─────────────────────────
// Native review of en/ar is still owed (same caveat as the intro's copy).

type Tri = Record<Lang, string>

export const REMOTE_UI = {
  // the code sheet
  codeTitle:    { he: 'הזמנה מהשולחן', en: 'Order from your table', ar: 'اطلبوا من الطاولة' },
  codeIntro:    { he: 'המלצר נותן לכם קוד בן 6 ספרות. מקלידים אותו כאן, והרשימה נשלחת ישר אליו.', en: 'Your waiter gives you a 6-digit code. Type it here and your list goes straight to them.', ar: 'يعطيكم النادل رمزًا من 6 أرقام. اكتبوه هنا وتصل القائمة إليه مباشرة.' },
  codeLabel:    { he: 'הקוד מהמלצר', en: 'The waiter\'s code', ar: 'رمز النادل' },
  codeHint:     { he: 'אין קוד? בקשו ממלצר — הוא יפיק אחד במכשיר שלו.', en: 'No code? Ask a waiter — they generate one on their device.', ar: 'ليس لديكم رمز؟ اطلبوه من النادل — يُنشئه على جهازه.' },
  connect:      { he: 'התחברות', en: 'Connect', ar: 'اتصال' },
  connecting:   { he: 'מתחברים…', en: 'Connecting…', ar: 'جارٍ الاتصال…' },
  // connected
  connectedAs:  { he: 'מחוברים לשולחן {n}', en: 'Connected to table {n}', ar: 'متصلون بالطاولة {n}' },
  recoverHint:  { he: 'התנתק הטלפון? מקלידים את אותו קוד שוב — ההזמנות ששלחתם נשמרות.', en: 'Phone died or switched? Type the same code again — what you sent is kept.', ar: 'انقطع الهاتف أو تغيّر؟ اكتبوا الرمز نفسه مجددًا — ما أرسلتموه محفوظ.' },
  disconnect:   { he: 'ניתוק מהשולחן', en: 'Disconnect', ar: 'قطع الاتصال' },
  // sending
  sendButton:   { he: 'שליחה למלצר', en: 'Send to waiter', ar: 'إرسال للنادل' },
  sendHint:     { he: 'הרשימה תגיע למלצר לאישור. היא לא נחשבת הזמנה עד שמלצר מאשר אותה.', en: 'Your list goes to the waiter for approval. It is not an order until a waiter confirms it.', ar: 'تصل القائمة إلى النادل للموافقة. لا تُعتبر طلبًا حتى يؤكدها النادل.' },
  sending:      { he: 'שולחים…', en: 'Sending…', ar: 'جارٍ الإرسال…' },
  sentTitle:    { he: 'נשלח למלצר', en: 'Sent to the waiter', ar: 'أُرسل إلى النادل' },
  sentBody:     { he: 'מלצר יעבור על זה ויאשר. אפשר להמשיך להוסיף ולשלוח עוד.', en: 'A waiter will go through it and confirm. You can keep adding and send more.', ar: 'سيراجعه النادل ويؤكده. يمكنكم متابعة الإضافة وإرسال المزيد.' },
  nothingNew:   { he: 'אין פריטים חדשים לשליחה.', en: 'Nothing new to send.', ar: 'لا توجد أصناف جديدة للإرسال.' },
  yourOrders:   { he: 'מה ששלחתם', en: 'What you sent', ar: 'ما أرسلتموه' },
  items:        { he: '{n} פריטים', en: '{n} items', ar: '{n} أصناف' },
  state: {
    pending:  { he: 'ממתין למלצר', en: 'Waiting for a waiter', ar: 'بانتظار النادل' },
    imported: { he: 'התקבל אצל המלצר', en: 'Taken by a waiter', ar: 'استلمه النادل' },
    rejected: { he: 'לא אושר — פנו למלצר', en: 'Not confirmed — ask a waiter', ar: 'لم يُؤكَّد — اسألوا النادل' },
    expired:  { he: 'פג תוקף', en: 'Expired', ar: 'انتهت صلاحيته' },
  } as Record<SubmissionState, Tri>,
  close:        { he: 'סגירה', en: 'Close', ar: 'إغلاق' },
  errors: {
    bad_request:      { he: 'משהו בבקשה לא תקין. נסו שוב.', en: 'Something in the request was not valid. Please try again.', ar: 'هناك خطأ في الطلب. حاولوا مجددًا.' },
    bad_code:         { he: 'הקוד לא נכון. בדקו מול המלצר.', en: 'That code is not right. Check with the waiter.', ar: 'الرمز غير صحيح. تحققوا من النادل.' },
    expired:          { he: 'הקוד פג תוקף. בקשו מהמלצר קוד חדש.', en: 'That code has expired. Ask the waiter for a new one.', ar: 'انتهت صلاحية الرمز. اطلبوا رمزًا جديدًا من النادل.' },
    too_many_devices: { he: 'יותר מדי מכשירים מחוברים לשולחן הזה. בקשו מהמלצר.', en: 'Too many phones are connected to this table. Ask the waiter.', ar: 'عدد كبير من الأجهزة متصل بهذه الطاولة. اسألوا النادل.' },
    no_session:       { he: 'אתם לא מחוברים לשולחן. הקלידו קוד מהמלצר.', en: 'You are not connected to a table. Type a code from the waiter.', ar: 'أنتم غير متصلين بطاولة. اكتبوا رمزًا من النادل.' },
    ended:            { he: 'החיבור לשולחן הסתיים. בקשו קוד חדש מהמלצר.', en: 'Your connection to the table has ended. Ask the waiter for a new code.', ar: 'انتهى الاتصال بالطاولة. اطلبوا رمزًا جديدًا من النادل.' },
    no_shift:         { he: 'אין כרגע צוות במשמרת. אפשר לגשת לבר.', en: 'No staff are on shift right now. Please come to the bar.', ar: 'لا يوجد طاقم في المناوبة الآن. تفضلوا إلى البار.' },
    too_many_pending: { he: 'כבר שלחתם כמה הזמנות שעדיין ממתינות למלצר. חכו שיאשר אותן.', en: 'You already have several lists waiting for a waiter. Please wait for them to be confirmed.', ar: 'لديكم عدة قوائم بانتظار النادل. انتظروا تأكيدها.' },
    too_fast:         { he: 'כבר שלחתם הרגע. חכו כמה שניות.', en: 'You just sent one. Please wait a few seconds.', ar: 'أرسلتم للتو. انتظروا بضع ثوانٍ.' },
    empty:            { he: 'אין פריטים חדשים לשליחה.', en: 'Nothing new to send.', ar: 'لا توجد أصناف جديدة للإرسال.' },
    rate_limited:     { he: 'יותר מדי ניסיונות — נסו שוב בעוד רגע.', en: 'Too many tries — please wait a moment.', ar: 'محاولات كثيرة — انتظروا قليلاً.' },
    disabled:         { he: 'השירות הזה לא זמין כרגע.', en: 'This is not available right now.', ar: 'هذه الخدمة غير متاحة حالياً.' },
    server:           { he: 'משהו השתבש. אפשר לסמן למלצר ביד.', en: 'Something went wrong. Please wave a waiter over.', ar: 'حدث خطأ. يمكنكم الإشارة إلى النادل.' },
  } as Record<RemoteError, Tri>,
} satisfies Record<string, unknown>

export function remoteErrorText(code: string | undefined, lang: Lang): string {
  const entry = (code && (REMOTE_UI.errors as Record<string, Tri>)[code]) || REMOTE_UI.errors.server
  return entry[lang] || entry.he
}

/** "מחוברים לשולחן 12" — the number is interpolated, never concatenated, so word
 *  order stays right in every language. */
export const connectedText = (n: number, lang: Lang) => REMOTE_UI.connectedAs[lang].replace('{n}', String(n))
export const itemsText = (n: number, lang: Lang) => REMOTE_UI.items[lang].replace('{n}', String(n))

/** Re-exported so the sheet needs one import for its input's length. */
export { TABLE_CODE_LENGTH }
