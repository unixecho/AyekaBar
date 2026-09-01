// The customer feedback box's vocabulary and its caps.
//
// Split from validate.ts the same way lib/cart/types.ts is split from the
// reducer that uses it: this file is what the SQL, the API route, the owner
// inbox and the customer sheet all have to agree on, and it holds no logic
// at all so agreeing on it is cheap.
//
// ⚠️ EVERY CAP BELOW IS SPELLED TWICE — here, and as a CHECK constraint in
// migration 050. That is deliberate (an app-layer rule that returns a useful
// message to a customer, plus a database rule that holds even if a future
// route forgets), and it is also a drift hazard of exactly the kind
// `lib/staff/access.ts` ↔ `is_op()` was built to prevent. Change one, change
// the other; `scripts/check-feedback.mjs` asserts these numbers still say
// what the migration says.

/** The two buckets a customer picks between before typing. They go to
 *  different places in the owner's head — a slow pour is a floor problem, a
 *  broken button is a bug — which is the entire reason the choice comes
 *  first rather than being inferred from the text afterwards. */
export const FEEDBACK_CATEGORIES = ['business', 'technical'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]

/** new → the owner has not looked. read → they have. resolved → they are
 *  done with it. Deliberately three, not two: "I have seen this" and "I have
 *  dealt with this" are different claims, and collapsing them means the
 *  inbox can only ever be all-unread or all-finished. */
export const FEEDBACK_STATUSES = ['new', 'read', 'resolved'] as const
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number]

/** Long enough for a real complaint, short enough that a single POST can
 *  never be a payload. ~1000 characters is about 150 Hebrew words. */
export const MAX_MESSAGE_LEN = 1000

/** Two characters, not one: a single character is never feedback, and the
 *  floor exists so an accidental submit produces an error rather than a row
 *  the owner has to triage. */
export const MIN_MESSAGE_LEN = 2

/** RFC 5321's maximum for a full address. */
export const MAX_EMAIL_LEN = 254

/** A same-origin path plus its query and hash. Generous — /menu#cocktails is
 *  20 characters — but bounded, because this arrives from the client. */
export const MAX_PAGE_URL_LEN = 300

// ── Rate limits ───────────────────────────────────────────────────────
// Both are enforced by the same table-backed `check_rate_limit()` every
// other public write path in this app uses (migration 045), so they hold
// across serverless instances rather than per warm container.

/** Per IP. Five submissions in ten minutes is far more than any honest
 *  visitor produces and far less than a script wants. */
export const FEEDBACK_RATE_MAX = 5
export const FEEDBACK_RATE_WINDOW_SECONDS = 600

/** ACROSS EVERYONE, same window. The per-IP limit alone does nothing against
 *  a botnet or a proxy pool, and this table is written by an endpoint with no
 *  login in front of it — without a ceiling, the only bound on how large it
 *  can grow is how many addresses the attacker can rent.
 *
 *  ⚠️ THE TRADE-OFF IS REAL AND IS ACCEPTED ON PURPOSE: while the global
 *  window is saturated, honest visitors are refused too. The number is set
 *  where that costs nothing in practice — sixty submissions in ten minutes is
 *  roughly a hundred times a busy night's real rate for one bar — so reaching
 *  it means something is wrong, and refusing everyone for a few minutes is a
 *  better failure than an unbounded table. It is also why the owner has a
 *  kill switch (`customer_feedback_enabled`): the durable answer to abuse is
 *  a human turning the box off, not this counter. */
export const FEEDBACK_GLOBAL_RATE_MAX = 60
export const FEEDBACK_GLOBAL_RATE_WINDOW_SECONDS = 600

/** One feedback row, as the owner inbox reads it. Column names, not
 *  camelCase, because this is the row — the same choice
 *  `lib/cart/submission.ts` makes for `SubmissionItem`, and for the same
 *  reason: a mismatch against the schema should be visible rather than
 *  buried in a mapper. */
export interface FeedbackRow {
  id: string
  category: FeedbackCategory
  message: string
  contact_email: string | null
  page_url: string | null
  customer_id: string | null
  status: FeedbackStatus
  resolved_at: string | null
  created_at: string
}

/** What the public endpoint accepts. `pageUrl` is camelCase because it is
 *  the WIRE shape the browser sends, not a row. */
export interface FeedbackInput {
  category: FeedbackCategory
  message: string
  contactEmail: string | null
  pageUrl: string | null
}
