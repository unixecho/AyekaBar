// Everything the feedback box refuses, in one pure module with no React, no
// DOM and no database — so `scripts/check-feedback.mjs` can run the REAL
// code headlessly instead of a copy of it that passes while the app is
// broken. Same discipline as `src/lib/cart/` and `src/lib/shifts/`.
//
// ── WHY THIS FILE IS THE INTERESTING ONE ─────────────────────────────
// POST /api/feedback is the only endpoint in this app that a total stranger
// can write to with no session, no code, no QR and no prior contact of any
// kind. `/api/loyalty/checkin` needs a signed-in customer AND a signed token;
// `redeem_table_code` needs six digits a waiter read out loud. This needs
// nothing. So everything that arrives here is hostile until proven otherwise,
// and this module is where that proof happens.
//
// ── WHAT IT RETURNS, AND WHY IT ISN'T A HEBREW SENTENCE ──────────────
// `lib/cart/submission.ts`'s validator returns its reasons in Hebrew, because
// its (future) caller shows them to a customer and Hebrew is this bar's
// language. This one returns a CODE instead: the feedback sheet is on the
// portal, which is the trilingual surface, and a customer reading the site in
// Arabic should not be told why their message was refused in Hebrew. The
// client maps the code through `FEEDBACK_UI` in i18n.ts; an unknown code
// falls back to a generic message, so adding a reason here can never render
// as a blank error.

import {
  FEEDBACK_CATEGORIES, FEEDBACK_STATUSES,
  MAX_EMAIL_LEN, MAX_MESSAGE_LEN, MAX_PAGE_URL_LEN, MIN_MESSAGE_LEN,
  type FeedbackCategory, type FeedbackInput, type FeedbackStatus,
} from './types'

export type FeedbackError =
  | 'bad_request'
  | 'bad_category'
  | 'message_empty'
  | 'message_too_long'
  | 'bad_email'

/** C0/C1 control characters, minus the newline a multi-line complaint
 *  legitimately contains. Stripped rather than rejected: a stray NUL from
 *  a broken keyboard app is not an attack, and refusing the whole message
 *  over one invisible byte loses feedback the owner wanted. Zero-width and
 *  bidi marks are deliberately NOT in here — U+200F is a normal part of
 *  written Hebrew and Arabic, and stripping it would corrupt real text. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Anything that has no business inside a same-origin path. Whitespace and
 *  backslash matter most: `\` is the character browsers fold into `/`, which
 *  is how `/\evil.com` becomes a protocol-relative URL. */
const PATH_FORBIDDEN = /[\u0000-\u001F\u007F\s\\<>"'`]/g

/**
 * Tidy a message without changing what it says.
 *
 * Newlines are normalised to \n and runs of blank lines collapsed, so a
 * message pasted from a phone keyboard doesn't render as a column of
 * whitespace in the inbox. Nothing else about the text is touched — this is
 * NOT an escaping step and must never be treated as one. The inbox renders
 * the message as React text, which escapes it; that is where XSS is
 * prevented, not here.
 */
export function normalizeMessage(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, MAX_MESSAGE_LEN)
    .trim()
}

/**
 * Reduce whatever the client sent to a SAME-ORIGIN PATH, or nothing.
 *
 * ⚠️ THIS IS THE SECURITY-CRITICAL ONE. The value ends up in an owner-facing
 * inbox where it is the obvious thing to make clickable ("which page was
 * this about?"), and an attacker who can put an arbitrary destination in
 * there gets a link the owner has every reason to trust, sitting inside an
 * OP-only admin page. So:
 *
 *   • It must start with exactly one '/'. `https://evil.com` fails; so does
 *     `javascript:alert(1)`, which starts with 'j'.
 *   • It must NOT start with '//'. `//evil.com` is a perfectly valid,
 *     perfectly off-site protocol-relative URL, and it is the case a naive
 *     "must start with /" check waves straight through. This is the whole
 *     reason this function exists rather than an inline startsWith('/').
 *   • Backslashes are stripped BEFORE that test, because browsers treat
 *     `/\evil.com` as `//evil.com`.
 *
 * Forbidden characters are dropped rather than rejecting the value outright:
 * a mangled hint is still a useful hint, and a null one is not. What comes
 * out is either a path this site could actually serve, or null.
 *
 * THE QUERY STRING IS DISCARDED HERE, not merely omitted by the caller.
 * FeedbackSheet already sends only `pathname + hash` — /checkin carries a
 * signed check-in token in its query, and next.config.mjs sets a
 * Referrer-Policy specifically to keep that token out of other people's logs.
 * Dropping `?…` in the VALIDATOR makes that a property of the endpoint rather
 * than of one client function: a future caller that forgets, or a hostile one
 * that posts a query on purpose, both land in the same place. The path and
 * the hash are what make a bug report actionable; the query never was.
 */
export function normalizePagePath(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const noQuery = input.split('?')[0]
  const cleaned = noQuery.replace(PATH_FORBIDDEN, '').slice(0, MAX_PAGE_URL_LEN)
  if (!cleaned.startsWith('/')) return null
  if (cleaned.startsWith('//')) return null
  return cleaned
}

/**
 * Deliberately permissive, and deliberately not an RFC 5322 parser.
 *
 * This address is never used to authenticate anything and nothing is sent to
 * it automatically — the owner reads it and decides whether to write back. So
 * the only job here is to reject the obviously-not-an-address (and anything
 * carrying a newline, which is how header injection starts if this ever DOES
 * become the input to a mail send). Being strict would mostly succeed at
 * rejecting real, unusual addresses.
 */
export function isPlausibleEmail(value: string): boolean {
  if (value.length > MAX_EMAIL_LEN) return false
  return /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\.]+(\.[^\s@<>"',;:\\.]+)+$/.test(value)
}

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value)
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value)
}

/**
 * The whole gate, in one call. Returns the exact object the route inserts —
 * never the caller's own object with a few fields checked, so a property the
 * client invented cannot ride along into the database.
 */
export function validateFeedbackInput(
  input: unknown,
): { ok: true; value: FeedbackInput } | { ok: false; error: FeedbackError } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'bad_request' }
  }
  const src = input as Record<string, unknown>

  if (!isFeedbackCategory(src.category)) return { ok: false, error: 'bad_category' }

  if (typeof src.message !== 'string') return { ok: false, error: 'message_empty' }
  // Length is judged BEFORE normalising, so a 50,000-character paste is
  // refused rather than silently truncated to something that looks like the
  // customer wrote it. The floor is judged after, since whitespace-only is
  // empty however long it is.
  if (src.message.length > MAX_MESSAGE_LEN) return { ok: false, error: 'message_too_long' }
  const message = normalizeMessage(src.message)
  if (message.length < MIN_MESSAGE_LEN) return { ok: false, error: 'message_empty' }

  let contactEmail: string | null = null
  if (src.contactEmail !== undefined && src.contactEmail !== null && src.contactEmail !== '') {
    if (typeof src.contactEmail !== 'string') return { ok: false, error: 'bad_email' }
    const trimmed = src.contactEmail.replace(CONTROL_CHARS, '').trim()
    // An empty string after trimming is "they left it blank", not "they got
    // it wrong" — the field is optional and must never block a submission.
    if (trimmed) {
      if (!isPlausibleEmail(trimmed)) return { ok: false, error: 'bad_email' }
      contactEmail = trimmed
    }
  }

  return {
    ok: true,
    value: { category: src.category, message, contactEmail, pageUrl: normalizePagePath(src.pageUrl) },
  }
}
