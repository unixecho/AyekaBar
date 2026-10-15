// A person's own details — name, phone, colour, emoji (2026-10-15). PURE: no React, no Supabase.
// scripts/check-profile.mjs runs this file.
//
// Owner: after a new employee links their Google account, an onboarding step lets them "change first or last name, add a
// phone number and select a colour and emoji"; accounts the owner CREATES get a random colour and emoji.
//
// WHERE THINGS LIVE (so nothing here needs a new table):
//   • colour → `staff.colour`  (migration 021, hex, the same colour the POS floor map and the scheduler already show),
//   • emoji  → `staff.initial` (migration 021, 1–2 characters — it IS the person's mark on the floor map, and one emoji
//              fits). The palette below is single-code-point emoji only, so the column's CHECK (length 1..2) always holds,
//   • names  → `staff.first_name` / `staff.last_name`,
//   • phone  → `staff.phone` — the ONE new column (migration 062, drafted; every phone code path degrades to "not
//              saved yet" until it exists, so shipping this before 062 is applied breaks nothing).

/** Colours a person may pick. Mid-lightness and saturated so a chip reads on the app's dark surfaces. */
export const PROFILE_COLOURS: readonly string[] = [
  '#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#2dd4bf',
  '#38bdf8', '#60a5fa', '#818cf8', '#a78bfa', '#e879f9', '#fb7185',
]

/** The colours' names, in the same order — for screen readers (a swatch is never labelled by colour alone). */
export const PROFILE_COLOUR_NAMES: readonly string[] = [
  'אדום', 'כתום', 'צהוב', 'ירוק בהיר', 'ירוק', 'טורקיז',
  'תכלת', 'כחול', 'אינדיגו', 'סגול', 'ורוד־סגול', 'ורוד',
]

/** Emoji a person may pick — each ONE code point (no variation selectors, no ZWJ sequences), so `staff.initial`'s
 *  CHECK (length between 1 and 2) is always satisfied. */
export const PROFILE_EMOJIS: readonly string[] = [
  '🍺', '🍷', '🍸', '🍹', '🥂', '🍕', '🍔', '🌮', '🍟', '🥗', '🍰', '☕',
  '🎧', '🎸', '🎲', '🎯', '🔥', '⭐', '🦊', '🐯', '🦁', '🐼', '🐙', '🦄',
  '🚀', '🌈', '🍀', '🌵',
]

export interface Identity { colour: string; initial: string }

/** The least-used colour and emoji among `used`, ties broken by `rand` — "random", but two people on one shift rarely
 *  look alike. Pure given `rand`; callers pass Math.random. */
export function pickIdentity(
  used: readonly { colour?: string | null; initial?: string | null }[],
  rand: () => number = Math.random,
): Identity {
  const leastUsed = (palette: readonly string[], key: 'colour' | 'initial') => {
    const count = new Map(palette.map((p) => [p, 0]))
    for (const u of used) { const v = u[key]; if (v && count.has(v)) count.set(v, (count.get(v) ?? 0) + 1) }
    const min = Math.min(...count.values())
    const pool = palette.filter((p) => count.get(p) === min)
    return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))]!
  }
  return { colour: leastUsed(PROFILE_COLOURS, 'colour'), initial: leastUsed(PROFILE_EMOJIS, 'initial') }
}

// ── the phone ──────────────────────────────────────────────────────────────

/** ⚠️ ONE RULE SPELLED TWICE with migration 062's CHECK constraint: Israeli local `0XXXXXXXX(X)` or `+` and 8–15 digits. */
export const PHONE_RE = /^(0[0-9]{8,9}|\+[0-9]{8,15})$/

/** What a person types ("050-123 4567", "+972 50 123 4567", "(050)1234567") → the stored form, or null when it is not
 *  a phone number. `+972…` for an Israeli number is stored as local `0…`. */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-().]/g, '')
  if (!s) return null
  let t = s
  if (t.startsWith('00')) t = `+${t.slice(2)}`
  if (/^\+972[0-9]{8,9}$/.test(t)) t = `0${t.slice(4)}`
  return PHONE_RE.test(t) ? t : null
}

// ── the form ───────────────────────────────────────────────────────────────

export const NAME_MAX = 40

export interface ProfileInput {
  firstName?: unknown
  lastName?: unknown
  phone?: unknown
  colour?: unknown
  initial?: unknown
}

export interface ProfileValue {
  first_name: string
  last_name: string | null
  /** undefined = leave the stored phone alone (the field was not sent); null = clear it. */
  phone?: string | null
  colour?: string
  initial?: string
}

export type ProfileError = 'first_name' | 'last_name' | 'phone' | 'colour' | 'initial'

export const PROFILE_MESSAGES: Record<ProfileError, string> = {
  first_name: 'כתבו שם פרטי (עד 40 תווים).',
  last_name: 'שם המשפחה ארוך מדי (עד 40 תווים).',
  phone: 'מספר הטלפון לא נראה תקין. למשל 050-1234567.',
  colour: 'הצבע שנבחר לא קיים ברשימה.',
  initial: 'האימוג׳י שנבחר לא קיים ברשימה.',
}

/** A name from a text box: trimmed, inner whitespace collapsed, control and zero-width characters dropped. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\t\n\r]/g, ' ') // a pasted line break is a space, not nothing
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠﻿]/g, '')
    .replace(/\s+/g, ' ').trim()
}

export function validateProfile(input: ProfileInput): { ok: true; value: ProfileValue } | { ok: false; error: ProfileError; message: string } {
  const fail = (error: ProfileError) => ({ ok: false as const, error, message: PROFILE_MESSAGES[error] })
  const first = cleanName(input.firstName)
  if (!first || first.length > NAME_MAX) return fail('first_name')
  const last = cleanName(input.lastName)
  if (last.length > NAME_MAX) return fail('last_name')
  const value: ProfileValue = { first_name: first, last_name: last || null }

  if (input.phone !== undefined) {
    if (input.phone === null || (typeof input.phone === 'string' && !input.phone.trim())) value.phone = null
    else {
      const p = typeof input.phone === 'string' ? normalizePhone(input.phone) : null
      if (!p) return fail('phone')
      value.phone = p
    }
  }
  if (input.colour !== undefined) {
    if (typeof input.colour !== 'string' || !PROFILE_COLOURS.includes(input.colour)) return fail('colour')
    value.colour = input.colour
  }
  if (input.initial !== undefined) {
    if (typeof input.initial !== 'string' || !PROFILE_EMOJIS.includes(input.initial)) return fail('initial')
    value.initial = input.initial
  }
  return { ok: true, value }
}
