// PHASE 2 — how a phone at a table proves it is at that table. BUILT 2026-10-13
// (routes `/api/table/session` + `/api/table/order`, the cart's code sheet, the
// POS's code + review screens) and SHIPPED OFF behind the developer's switch
// `table_ordering_enabled` (/owner/dev). Design record: PLAN_MENU_CART.md §12.
//
// The constants below are the single place the client, the routes and the SQL in
// `supabase/migrations/048_*.sql` and `058_remote_ordering.sql` all read the same
// numbers from — the way `lib/staff/access.ts` and `is_op()` are one rule
// spelled twice. Drift between those two is the original bug that whole
// pattern exists to prevent. `scripts/check-remote-ordering.mjs` pins every
// number below against the SQL text itself.
//
// ── 058: THE CODE IS NOW RECOVERABLE (owner, 2026-10-13) ─────────────
// 048 made a code single-use. The owner asked for the opposite: once a customer
// is authenticated "the session needs to be saved and can be recovered via the
// 6-digit code", and "later on a freshly printed QR code will be linked with the
// 6-digit code and will be the source of authentication". So a code row is now a
// VISIT — activated by the first redemption, alive for three hours, redeemable
// again from a new phone or after a cleared cookie, and ended by staff (or when
// the POS closes the table). Recovery never extends the visit. The QR will be a
// second credential for the SAME visit; nothing here is keyed to the digits, so
// it slots in without a redesign (PLAN_MENU_CART.md §12.5).
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

/** How long a code stays good for its FIRST use, in seconds. Ten minutes: the
 *  waiter reads it out and walks away; the customer types it within a minute or
 *  two. A code nobody typed that outlives the interaction outlives the trust.
 *  (Once typed, the visit it opened runs for TABLE_SESSION_TTL_SECONDS.) */
export const TABLE_CODE_TTL_SECONDS = 600

/** (Retired 2026-10-13: `TABLE_CODE_MAX_ATTEMPTS`, the five-attempt burn.)
 *
 *  It was never the brute-force defence — a wrong guess hashes to no row, so no
 *  counter can rise (migration 049) — and a RECOVERABLE code cannot burn on
 *  repeated correct use, which is now the normal case. What bounds a leaked code
 *  instead is TABLE_VISIT_MAX_DEVICES below, the fixed visit end, and the
 *  waiter's rotate / end buttons. Brute force is bounded by, in order:
 *  TABLE_CODE_RATE_* and TABLE_CODE_GLOBAL_FAIL_* below, the handful of codes
 *  live at any moment, and the fact that a human reviews every submission. */

/** Per-IP redemption attempts per window, for `checkRateLimit()`. THIS is the
 *  real bound on guessing, not any per-code counter. Mirrors the checkin/redeem
 *  posture (045). Counted on EVERY attempt. */
export const TABLE_CODE_RATE_MAX = 10
export const TABLE_CODE_RATE_WINDOW_SECONDS = 300
/** The global one (049 made it a requirement): WRONG guesses venue-wide per
 *  window, across all IPs — a per-IP limit does nothing against a sprayer with
 *  many addresses. Recorded only on `bad_code`, and PEEKED before each attempt
 *  (`peekRateLimit()` in lib/rate-limit.ts) so that once it is exceeded the guess
 *  is never even evaluated. A deliberate cost: a sustained spray can lock the
 *  endpoint for everyone for the rest of the window — a waiter can still take the
 *  order by hand, which is the failure mode this feature must always have. */
export const TABLE_CODE_GLOBAL_FAIL_MAX = 50
export const TABLE_CODE_GLOBAL_FAIL_WINDOW_SECONDS = 300

/** How long a visit lasts once it is activated, and so how long EVERY session
 *  of that visit lasts — recovery (typing the digits again) does not extend it.
 *  Deliberately shorter than a night out: a phone that authenticated at 21:00
 *  should not still be able to order to that table at 02:00 after its owner has
 *  gone home and someone else is sitting there. The waiter ends the visit
 *  sooner with one tap, and the POS ends it itself when the table closes.
 *  ⚠️ SQL twin: 058 `redeem_table_code` (`make_interval(secs => 10800)`). */
export const TABLE_SESSION_TTL_SECONDS = 3 * 60 * 60

/** How many phones may be signed into ONE visit at once — a leaked code cannot
 *  be turned into unlimited cookies. A signed-out phone frees its slot; hitting
 *  the cap does NOT burn the code. ⚠️ SQL twin: 058 `redeem_table_code` (`>= 6`). */
export const TABLE_VISIT_MAX_DEVICES = 6

/** Pending (unreviewed) requests one visit may hold, and the minimum gap between
 *  two sends from it. Counted across all the visit's devices. Together they cap
 *  what a leaked code can do: a few pending rows a waiter rejects.
 *  ⚠️ SQL twins: 058 `create_cart_submission` (`>= 3`, `interval '20 seconds'`). */
export const VISIT_MAX_PENDING = 3
export const SUBMISSION_MIN_GAP_SECONDS = 20

/** How long a pending request stays on the staff's list. ⚠️ SQL twin: 058
 *  `waiter_pending_submissions` (`interval '2 hours'`). */
export const SUBMISSION_OPEN_WINDOW_MINUTES = 120

/** The httpOnly cookie that carries a phone's session token — 32 random bytes,
 *  hex; only its SHA-256 is stored. HttpOnly so an XSS on the menu cannot steal
 *  the right to order to a table. Declared in lib/privacy/registry.ts. */
export const TABLE_SESSION_COOKIE = 'ayeka_table_session'

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
