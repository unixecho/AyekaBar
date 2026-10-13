// "Call a waiter" — the customer-facing half, PURE (no React, no DOM, no
// Supabase). Added 2026-10-13: "wire up Customers calling Staff on shift from
// the menu but don't enable it, I want to test it for now."
//
// THE FLOW. A customer at a table opens the menu, builds a cart (or doesn't),
// taps "קריאה למלצר", says which table they are at and what they need. The
// request goes to POST /api/table/call, which — only when the developer's
// switch is on — writes one waiter_table_calls row through create_table_call()
// (migration 057). Every front-of-house person who is on shift and inside the
// shift's hours is then told, in the POS, until one of them taps "קיבלתי".
//
// ── HOW THE TABLE IS KNOWN, AND WHY THAT IS A DECISION NOT A DEFAULT ────
// The customer TYPES the number printed on the table. PLAN_MENU_CART.md §9
// rightly says a typed number "proves nothing" — and for ORDERING (Phase 2)
// that is disqualifying, which is why that phase is gated on a waiter-issued
// code. A CALL is a different stake: the worst a lie achieves is a waiter
// walking to a table that did not ask. So this endpoint accepts the typed
// number and spends its effort on containing abuse instead (a per-IP and a
// global rate limit; the owner/dev switch; an open shift required; a table
// that must exist and be active; the same call within three minutes collapses
// into the open one). If the bar later wants calls tied to a real seated
// customer, `redeem_table_code` (048) already issues a table-scoped session —
// this route can require it without changing the wire shape.

import type { Lang } from '../menu/types'

export const CALL_KINDS = ['waiter', 'bill', 'assistance'] as const
export type CallKind = (typeof CALL_KINDS)[number]

export const CALL_TABLE_MIN = 1
export const CALL_TABLE_MAX = 999
export const CALL_CART_ITEMS_MAX = 500
export const CALL_CART_TOTAL_MAX_AGOROT = 100_000_000

/** Per-IP: a table calls once, maybe twice. Four in ten minutes is generous. */
export const CALL_RATE_MAX = 4
export const CALL_RATE_WINDOW_SECONDS = 600
/** Global: a full house calling at once is tens, not hundreds. The second
 *  limit exists because a per-IP limit does not stop a distributed sprayer
 *  (048/049 spell the same lesson out for the code endpoint). */
export const CALL_GLOBAL_RATE_MAX = 80
export const CALL_GLOBAL_RATE_WINDOW_SECONDS = 600

/** How long an unanswered call stays on the staff's list (SQL: 2 hours). */
export const CALL_OPEN_WINDOW_MINUTES = 120
/** Same table + same kind inside this window collapses into the open call
 *  (SQL: 3 minutes). */
export const CALL_DEDUPE_MINUTES = 3

/** Who is told. Front of house: the people who walk to a table, plus OP who
 *  can step in. Bartenders and cooks are not — and when a published schedule
 *  exists the schedule half narrows it further (lib/shifts/presence.ts).
 *
 *  ⚠️ MIRRORED IN SQL by waiter_is_call_recipient() (migration 057), part (b):
 *     role = 'owner' or badge in ('owner','general_manager','manager','waiter')
 *     or lower(badge) = 'dev'
 *  — one rule spelled twice. */
export const CALL_RECIPIENT_BADGES = ['owner', 'general_manager', 'manager', 'waiter'] as const

export function isCallRecipientTitle(row: { role?: string | null; badge?: string | null } | null | undefined): boolean {
  if (!row) return false
  if (row.role === 'owner') return true
  const badge = row.badge ?? ''
  if ((CALL_RECIPIENT_BADGES as readonly string[]).includes(badge)) return true
  return badge.toLowerCase() === 'dev'
}

// ── Input ────────────────────────────────────────────────────────────────

export type CallError = 'bad_request' | 'bad_table' | 'bad_kind' | 'bad_cart'

export interface CallInput {
  tableNumber: number
  kind: CallKind
  cartItems: number
  cartTotalAgorot: number
}

const isIntInRange = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

/** The whole gate in front of the public endpoint's insert. Returns the exact
 *  object that is used — never the caller's own with a few fields checked.
 *  Accepts a numeric STRING for the table (a form field), nothing else. */
export function validateCallInput(body: unknown): { ok: true; value: CallInput } | { ok: false; error: CallError } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'bad_request' }
  const b = body as Record<string, unknown>

  let table: unknown = b.tableNumber
  if (typeof table === 'string' && /^\s*\d{1,4}\s*$/.test(table)) table = Number(table.trim())
  if (!isIntInRange(table, CALL_TABLE_MIN, CALL_TABLE_MAX)) return { ok: false, error: 'bad_table' }

  const kind = b.kind === undefined ? 'waiter' : b.kind
  if (typeof kind !== 'string' || !(CALL_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'bad_kind' }

  // The cart context is optional and advisory — counts only, never contents.
  const items = b.cartItems === undefined ? 0 : b.cartItems
  const total = b.cartTotalAgorot === undefined ? 0 : b.cartTotalAgorot
  if (!isIntInRange(items, 0, CALL_CART_ITEMS_MAX) || !isIntInRange(total, 0, CALL_CART_TOTAL_MAX_AGOROT)) {
    return { ok: false, error: 'bad_cart' }
  }

  return { ok: true, value: { tableNumber: table, kind: kind as CallKind, cartItems: items, cartTotalAgorot: total } }
}

/** What create_table_call() can say back, mapped to a status. */
export type CallRpcReason = 'bad_kind' | 'unknown_table' | 'no_shift'
export const CALL_REASON_STATUS: Record<CallRpcReason, number> = {
  bad_kind: 400, unknown_table: 404, no_shift: 409,
}

// ── Words (customer-facing: all three languages) ─────────────────────────

type Tri = Record<Lang, string>

export const CALL_UI = {
  title:       { he: 'קריאה למלצר', en: 'Call a waiter', ar: 'استدعاء نادل' },
  intro:       { he: 'בחרו מה צריך ואת מספר השולחן — המלצרים במשמרת יקבלו הודעה.', en: 'Pick what you need and your table number — the waiters on shift are notified.', ar: 'اختاروا ما تحتاجون ورقم الطاولة — سيصل إشعار للنُدُل المناوبين.' },
  kindLabel:   { he: 'מה צריך?', en: 'What do you need?', ar: 'ماذا تحتاجون؟' },
  kinds: {
    waiter:     { he: 'מלצר', en: 'A waiter', ar: 'نادل' },
    bill:       { he: 'חשבון', en: 'The bill', ar: 'الحساب' },
    assistance: { he: 'עזרה', en: 'Help', ar: 'مساعدة' },
  } as Record<CallKind, Tri>,
  tableLabel:  { he: 'מספר השולחן', en: 'Table number', ar: 'رقم الطاولة' },
  tableHint:   { he: 'המספר מופיע על השולחן.', en: 'The number is printed on the table.', ar: 'الرقم مكتوب على الطاولة.' },
  cartNote:    { he: 'נעדכן את המלצר שיש הזמנה בעגלה.', en: 'We will let the waiter know there is an order in the cart.', ar: 'سنُعلم النادل بوجود طلب في السلة.' },
  send:        { he: 'קראו למלצר', en: 'Call now', ar: 'استدعوا النادل' },
  sending:     { he: 'שולחים…', en: 'Sending…', ar: 'جارٍ الإرسال…' },
  sentTitle:   { he: 'ההודעה נשלחה', en: 'Sent', ar: 'تم الإرسال' },
  sentBody:    { he: 'מלצר יגיע אליכם בקרוב. אין צורך ללחוץ שוב.', en: 'A waiter will be with you shortly. No need to tap again.', ar: 'سيأتيكم النادل قريباً. لا حاجة للضغط مجدداً.' },
  close:       { he: 'סגירה', en: 'Close', ar: 'إغلاق' },
  errors: {
    bad_table:     { he: 'מספר שולחן לא תקין.', en: 'That table number is not valid.', ar: 'رقم الطاولة غير صالح.' },
    unknown_table: { he: 'לא מצאנו שולחן עם המספר הזה.', en: 'We could not find a table with that number.', ar: 'لم نجد طاولة بهذا الرقم.' },
    no_shift:      { he: 'אין כרגע צוות במשמרת. אפשר לגשת לבר.', en: 'No staff are on shift right now. Please come to the bar.', ar: 'لا يوجد طاقم في المناوبة الآن. تفضلوا إلى البار.' },
    rate_limited:  { he: 'יותר מדי ניסיונות — נסו שוב בעוד רגע.', en: 'Too many tries — please wait a moment.', ar: 'محاولات كثيرة — انتظروا قليلاً.' },
    disabled:      { he: 'השירות הזה לא זמין כרגע.', en: 'This is not available right now.', ar: 'هذه الخدمة غير متاحة حالياً.' },
    server:        { he: 'משהו השתבש. אפשר לסמן למלצר ביד.', en: 'Something went wrong. Please wave a waiter over.', ar: 'حدث خطأ. يمكنكم الإشارة إلى النادل.' },
  } as Record<string, Tri>,
} satisfies Record<string, unknown>

/** The message for a server error code, falling back to the generic one. */
export function callErrorText(code: string | undefined, lang: Lang): string {
  const entry = (code && CALL_UI.errors[code]) || CALL_UI.errors.server
  return entry[lang] || entry.he
}
