// The onboarding wizard's PURE half: what a join link looks like, what state it can be in, the words for every
// state, and which wizard screen a visitor is on. No React, no Supabase, no Node — scripts/check-join.mjs runs this
// very file. The database half is migration 059; the server half (minting, hashing, the RPC calls) is
// ./join-server.ts.
//
// THE FLOW (owner, 2026-10-14: "owners need to have a link to give freshly created employee accounts, and they
// must link their account with Gmail in order to access the shift system"):
//
//   owner creates the person → presses "קישור הצטרפות" → sends the link → the person opens /join/<token>,
//   sees who the link is for, signs in with Google (the house two-step interstitial), confirms the account shown,
//   and that Google account becomes the staff row's login. Until then the row has no auth_user_id, so every page
//   that needs a staff row — including /staff/schedule — is closed to it. That IS the requirement; nothing here adds
//   a second gate.

/** ⚠️ ONE RULE SPELLED TWICE with migration 059's default (168) and ceiling (720). */
export const JOIN_TTL_HOURS_DEFAULT = 168
export const JOIN_TTL_HOURS_MAX = 720

/** 32 random bytes as base64url is exactly 43 characters. A token of any other shape is refused before it touches
 *  the database, so a typo'd or truncated link costs nothing. */
export const JOIN_TOKEN_BYTES = 32
export const JOIN_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const isJoinToken = (s: unknown): s is string => typeof s === 'string' && JOIN_TOKEN_RE.test(s)

export const joinPath = (token: string): string => `/join/${token}`

/** Rate limits (per window), used by the routes. The token has 256 bits, so these are about noise, not about
 *  guessing. */
export const JOIN_LIMITS = {
  /** Owner pressing the button: generous, it is an authenticated admin. */
  issue: { max: 30, windowSeconds: 600 },
  /** A visitor loading the wizard page, per IP. */
  peek: { max: 40, windowSeconds: 300 },
  /** A signed-in person confirming, per person. */
  claim: { max: 10, windowSeconds: 600 },
} as const

export type JoinStatus = 'ok' | 'unknown' | 'expired' | 'used' | 'revoked' | 'inactive' | 'linked'
const STATUSES: readonly JoinStatus[] = ['ok', 'unknown', 'expired', 'used', 'revoked', 'inactive', 'linked']

export interface JoinPeek {
  status: JoinStatus
  firstName: string | null
  badge: string | null
  expiresAt: string | null
}

/** What `staff_join_peek()` returned, made safe to use. Anything unexpected is "unknown" — the calm dead end. */
export function parsePeek(data: unknown): JoinPeek {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const status = STATUSES.includes(d.status as JoinStatus) ? (d.status as JoinStatus) : 'unknown'
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null)
  return {
    status,
    firstName: status === 'ok' ? str(d.first_name) : null,
    badge: status === 'ok' ? str(d.badge) : null,
    expiresAt: status === 'ok' ? str(d.expires_at) : null,
  }
}

export type ClaimReason =
  | 'unknown' | 'no_user' | 'not_google' | 'revoked' | 'used' | 'expired' | 'inactive'
  | 'owner_role' | 'taken' | 'already_staff' | 'email_in_use'
const CLAIM_REASONS: readonly ClaimReason[] = [
  'unknown', 'no_user', 'not_google', 'revoked', 'used', 'expired', 'inactive',
  'owner_role', 'taken', 'already_staff', 'email_in_use',
]

export interface JoinClaim { ok: boolean; already: boolean; reason: ClaimReason | null }

export function parseClaim(data: unknown): JoinClaim {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  if (d.ok === true) return { ok: true, already: d.already === true, reason: null }
  const reason = CLAIM_REASONS.includes(d.reason as ClaimReason) ? (d.reason as ClaimReason) : 'unknown'
  return { ok: false, already: false, reason }
}

/** HTTP status for a refused claim. 4xx for "this link/account cannot do that", never a 5xx. */
export const CLAIM_STATUS: Record<ClaimReason, number> = {
  unknown: 404, no_user: 401, not_google: 403, revoked: 410, used: 410, expired: 410, inactive: 403,
  owner_role: 403, taken: 409, already_staff: 409, email_in_use: 409,
}

export interface JoinMessage { title: string; body: string }

/** Hebrew only: this is a staff surface. Every status and every refusal has a sentence, so no state ends in a
 *  blank screen or a raw error code. */
export const JOIN_MESSAGES: Record<JoinStatus | ClaimReason, JoinMessage> = {
  ok: { title: 'הקישור תקין', body: '' },
  unknown: {
    title: 'הקישור לא נמצא',
    body: 'ייתכן שהוא הועתק לא במלואו. בקשו מהמנהל לשלוח קישור חדש.',
  },
  expired: { title: 'תוקף הקישור פג', body: 'בקשו מהמנהל לשלוח קישור חדש — זה לוקח לו רגע.' },
  used: {
    title: 'הקישור כבר נוצל',
    body: 'אם כבר חיברתם חשבון — היכנסו מדף הכניסה. אחרת, בקשו מהמנהל קישור חדש.',
  },
  revoked: { title: 'הקישור בוטל', body: 'המנהל יצר קישור חדש במקומו — השתמשו בקישור האחרון שקיבלתם.' },
  inactive: { title: 'הכרטיס הזה כבר לא פעיל', body: 'פנו למנהל.' },
  linked: { title: 'החשבון כבר מחובר', body: 'אפשר להיכנס עם Google מדף הכניסה.' },
  no_user: { title: 'צריך להתחבר מחדש', body: 'ההתחברות פגה. התחברו עם Google ונסו שוב.' },
  not_google: {
    title: 'אפשר להתחבר רק עם חשבון Google מאומת',
    body: 'התחברו עם חשבון Gmail או חשבון Google אחר שהכתובת שלו מאומתת.',
  },
  owner_role: {
    title: 'אי אפשר לחבר הרשאות מלאות בקישור',
    body: 'הרשאות ניהול ניתנות רק בהזמנה לפי אימייל. פנו למנהל.',
  },
  taken: { title: 'הכרטיס הזה כבר חובר לחשבון אחר', body: 'אם זו טעות, פנו למנהל.' },
  already_staff: {
    title: 'חשבון ה-Google הזה כבר רשום בצוות',
    body: 'אין צורך בקישור — היכנסו מדף הכניסה. אם רציתם חשבון אחר, החליפו חשבון והמשיכו.',
  },
  email_in_use: {
    title: 'הכתובת הזו כבר רשומה בכרטיס אחר',
    body: 'ייתכן שהמנהל פתח עבורכם שני כרטיסים. בקשו ממנו לאחד אותם ולשלוח קישור חדש.',
  },
}

export const messageFor = (key: JoinStatus | ClaimReason): JoinMessage => JOIN_MESSAGES[key] ?? JOIN_MESSAGES.unknown

// ── the wizard's screens ───────────────────────────────────────────────────

export type WizardStep = 'dead' | 'welcome' | 'connect' | 'confirm' | 'done'

/** Which screen to show. `introSeen` is the one piece of local state: the welcome screen is shown first and the
 *  visitor taps through it. Everything else is a fact the server knows (status, signed in, already claimed). */
export function wizardStep(s: { status: JoinStatus; signedIn: boolean; claimed: boolean; introSeen: boolean }): WizardStep {
  if (s.claimed) return 'done'
  if (s.status !== 'ok') return 'dead'
  if (s.signedIn) return 'confirm'
  return s.introSeen ? 'connect' : 'welcome'
}

/** The progress dots: 3 steps — meet, connect Google, done. */
export const WIZARD_STEPS = [
  { key: 'welcome', label: 'ברוכים הבאים' },
  { key: 'connect', label: 'חיבור Google' },
  { key: 'done', label: 'מוכנים' },
] as const

export function progressIndex(step: WizardStep): number {
  switch (step) {
    case 'welcome': return 0
    case 'connect': case 'confirm': return 1
    case 'done': return 2
    default: return 0
  }
}

// ── the owner's side ───────────────────────────────────────────────────────

export type JoinLinkState = 'none' | 'live' | 'expired' | 'used'

export interface JoinLinkRow { expires_at: string; used_at: string | null; revoked_at: string | null }

/** What the roster shows next to a person who has not signed in yet. A revoked link counts as none. */
export function joinLinkState(link: JoinLinkRow | null | undefined, now: Date = new Date()): JoinLinkState {
  if (!link || link.revoked_at) return 'none'
  if (link.used_at) return 'used'
  return new Date(link.expires_at).getTime() > now.getTime() ? 'live' : 'expired'
}

/** The message the owner sends. Short, no emoji soup, says who it is from and what to do. */
export function shareText(firstName: string | null, url: string): string {
  const hello = firstName ? `היי ${firstName},` : 'היי,'
  return `${hello} זה הקישור להצטרפות לצוות אייכה בר. נכנסים, מתחברים עם חשבון Google ואפשר לראות את המשמרות:\n${url}`
}

export function shareLinks(text: string): { whatsapp: string; sms: string; mailto: string } {
  const t = encodeURIComponent(text)
  return {
    whatsapp: `https://wa.me/?text=${t}`,
    sms: `sms:?&body=${t}`,
    mailto: `mailto:?subject=${encodeURIComponent('הצטרפות לצוות אייכה בר')}&body=${t}`,
  }
}

/** "עד יום חמישי, 22.10" — when a live link stops working. Hebrew, venue timezone. */
export function expiryLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric',
  }).format(d)
}
