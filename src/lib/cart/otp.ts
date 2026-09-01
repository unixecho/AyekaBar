// PHASE 2 GROUNDWORK — how a phone at a table proves it is at that table.
//
// NOTHING HERE IS WIRED UP. There is no endpoint, no UI and no table yet. This
// file is the decision record in code form, and the constants below are the
// single place the client, the future route and the SQL in
// `supabase/migrations/048_customer_table_ordering_groundwork.sql` all read the same
// numbers from — the way `lib/staff/access.ts` and `is_op()` are one rule
// spelled twice. Drift between those two is the original bug that whole
// pattern exists to prevent, so it is set up correctly from the start here.
//
// ── THE OWNER'S MODEL (2026-09-01), IN ONE PARAGRAPH ─────────────────
// The waiter generates a 6-digit code in their own app, standing at the table,
// and reads it to the customer. The customer types it into the website. That
// IS the authentication: possession of a code that a specific member of staff
// minted, in person, seconds ago, for a specific table. Nobody's phone number
// is collected, nobody signs up, and no SMS is sent.
//
// ── WHY THIS IS THE RIGHT MECHANISM, NOT A COMPROMISE ────────────────
// The alternatives all cost more and prove less:
//
//   Per-table QR (`/menu?table=12`)  — the sticker is on the table forever.
//     Anyone who has ever photographed it, or walked past it, can order to
//     table 12 from the car park. It identifies a TABLE; it does not
//     authenticate a PERSON SITTING AT ONE.
//   "Type your table number"         — no authentication at all.
//   SMS OTP (Twilio)                 — authenticates a PHONE NUMBER, which is
//     not the question being asked, costs money per message, and newly makes
//     this app a processor of customers' phone numbers (a privacy-policy and
//     a data-minimisation problem that did not previously exist).
//   Google sign-in                   — authenticates an ACCOUNT. Also not the
//     question, and it puts a login wall in front of a bar menu.
//
// A staff-issued, table-scoped, short-lived code is the only one of these that
// answers the actual question, and it needs no third party at all. It is the
// same trust model the bar already runs on: the waiter is standing there.
//
// ── THE TWILIO / GMAIL BRANCH THE OWNER ASKED ABOUT ──────────────────
// The owner's ask was: "if the owner doesn't want to use Twilio we will add an
// option to hook it into their Gmail." Both of those are about DELIVERY, and
// the flow above needs no delivery — the waiter's mouth is the channel. So the
// setting exists with three values and `handoff` is the default and the
// recommendation:
//
//   'handoff'  the waiter reads the code out. No third party, no cost, no
//              personal data. Ship this one.
//   'sms'      Twilio (or an Israeli gateway). Requires collecting the
//              customer's phone number → privacy policy update, a new
//              processor, per-message cost. Only worth it for a flow where
//              no staff member is present, which is not this flow.
//   'email'    the customer's own address. Same objection, plus: "hook it into
//              their Gmail" as an SMTP SENDER is a different feature — that is
//              the bar emailing ITSELF or a customer a RECEIPT, and it belongs
//              with `PLAN_PAYMENTS.md`'s receipts work, not with proving where
//              somebody is sitting.
//
// Recording it here so the branch is a decision with reasons attached rather
// than a fork somebody has to re-derive later.
//
// ── LOYALTY ──────────────────────────────────────────────────────────
// "count the order as points and hook it into the loyalty system."
// The hook point is deliberately NOT here. Points are minted by
// `award_points()` (migration 008) which does check + write + audit in one
// transaction, precisely so nothing awards points by reading and then writing
// from JS. An order submitted from a phone earns points at the moment the
// waiter IMPORTS it and the order is eventually paid — never at submission,
// because a submission is a request, not a sale. What Phase 2 has to carry
// for that to work later is one nullable `customer_id` on the submission row,
// which migration 048 drafts. The loyalty club is switched off today
// (`loyalty_enabled`), and this whole path stays dark until it isn't.

/** Six digits. Long enough that guessing inside the window is hopeless once
 *  rate-limited (see below), short enough to say out loud across a noisy bar
 *  without repeating yourself. */
export const TABLE_CODE_LENGTH = 6

/** How long a code stays good, in seconds. Ten minutes: the waiter reads it
 *  out and walks away; the customer types it within a minute or two. A code
 *  that outlives the interaction is a code that outlives the trust. */
export const TABLE_CODE_TTL_SECONDS = 600

/** Wrong guesses before the CODE (not the customer) is burned. Five attempts
 *  against a 6-digit space inside 10 minutes is a 1-in-200,000 chance; the
 *  cap is what makes that true, and it is enforced in SQL rather than in a
 *  route, so it holds no matter which caller arrives. */
export const TABLE_CODE_MAX_ATTEMPTS = 5

/** Per-IP redemption attempts per window, for `checkRateLimit()` — the outer
 *  layer, stopping someone from burning through fresh codes rather than one
 *  code's own attempts. Mirrors the checkin/redeem posture (migration 045). */
export const TABLE_CODE_RATE_MAX = 10
export const TABLE_CODE_RATE_WINDOW_SECONDS = 300

/** How long a verified table session lasts. Deliberately shorter than a night
 *  out: a phone that authenticated at 21:00 should not still be able to order
 *  to that table at 02:00 after its owner has gone home and someone else is
 *  sitting there. Re-authenticating costs one more code from the waiter. */
export const TABLE_SESSION_TTL_SECONDS = 3 * 60 * 60

/**
 * How the code reaches the customer.
 * See the long note above — `handoff` is the default and the recommendation;
 * the other two exist because the owner asked what the options were, and each
 * one has a real cost written down next to it.
 */
export type TableCodeChannel = 'handoff' | 'sms' | 'email'
export const TABLE_CODE_CHANNEL_DEFAULT: TableCodeChannel = 'handoff'

/** Strip everything a person might type around the digits — spaces, dashes,
 *  an accidental RTL mark from a Hebrew keyboard, a pasted "קוד: 123456". */
export function normalizeTableCode(raw: string): string {
  return (raw ?? '').replace(/\D+/g, '').slice(0, TABLE_CODE_LENGTH)
}

export function isValidTableCodeShape(code: string): boolean {
  return new RegExp(`^\\d{${TABLE_CODE_LENGTH}}$`).test(code)
}

/**
 * Format for reading out loud: "123 456". Grouped in threes because that is
 * how a person says a six-digit number and how the listener chunks it.
 * `dir="ltr"` at the call site — digits are LTR even inside Hebrew.
 */
export function formatTableCode(code: string): string {
  const c = normalizeTableCode(code)
  return c.length === TABLE_CODE_LENGTH ? `${c.slice(0, 3)} ${c.slice(3)}` : c
}
