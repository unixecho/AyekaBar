// Staff job-title badges. `role` (staff | owner) is the authorization level;
// `badge` here is the display job title the owner assigns. Extendable — the
// owner UI also allows a custom badge, which falls back to neutral styling.
//
// These strings are user-facing on the public /team page, so every badge
// carries he/en/ar like the rest of the app.

export type BadgeKey =
  | 'owner' | 'general_manager' | 'manager'
  | 'bartender' | 'waiter' | 'cook' | 'busboy' | 'receptionist'

export interface BadgeMeta {
  key: string
  he: string
  en: string
  ar: string
  emoji: string
  /** accent color (hex) used for the chip text/border */
  color: string
}

export const BADGES: Record<BadgeKey, BadgeMeta> = {
  owner:           { key: 'owner',           he: 'בעלים',          en: 'Owner',           ar: 'مالك',            emoji: '⭐', color: '#ff8a5c' },
  general_manager: { key: 'general_manager', he: 'מנהל/ת כללי/ת',  en: 'General Manager', ar: 'مدير عام',        emoji: '🎯', color: '#fb7185' },
  manager:         { key: 'manager',         he: 'אחראי/ת משמרת',  en: 'Shift Manager',   ar: 'مسؤول/ة الوردية', emoji: '🗂️', color: '#f472b6' },
  bartender:       { key: 'bartender',       he: 'ברמן/ית',        en: 'Bartender',       ar: 'نادل/ة بار',      emoji: '🍸', color: '#c084fc' },
  waiter:          { key: 'waiter',          he: 'מלצר/ית',        en: 'Waiter',          ar: 'نادل/ة',          emoji: '🍽️', color: '#60a5fa' },
  cook:            { key: 'cook',            he: 'טבח/ית',         en: 'Cook',            ar: 'طاهٍ/طاهية',      emoji: '👨‍🍳', color: '#fbbf24' },
  busboy:          { key: 'busboy',          he: 'עוזר/ת טבח',     en: 'Busboy',          ar: 'مساعد/ة طاهٍ',    emoji: '🔪', color: '#a3e635' },
  receptionist:    { key: 'receptionist',    he: 'מארח/ת',         en: 'Host',            ar: 'مضيف/ة',          emoji: '🛎️', color: '#2dd4bf' },
}

/** Selectable job titles in the owner UI. `owner` is in here as a real title —
 *  the bar has two co-owners who should read as "בעלים" on the team page. It is
 *  deliberately NOT the same thing as the `role` column, which is admin access
 *  and is shown separately as "הרשאות". */
export const BADGE_OPTIONS: BadgeMeta[] = [
  BADGES.owner, BADGES.general_manager, BADGES.manager, BADGES.bartender,
  BADGES.waiter, BADGES.cook, BADGES.busboy, BADGES.receptionist,
]

/** The job titles that make someone part of הנהלה rather than עובדים. Used by
 *  the roster split on /owner/staff — a group that changes once a year sitting
 *  above the group that changes every month.
 *
 *  Deliberately about the JOB TITLE, not the access level: a shift manager
 *  runs the floor on a Friday night whether or not anyone ever handed them
 *  admin rights, and an owner who never signs in is still management. Access
 *  is a separate axis and keeps its own chip on every row. */
export const MANAGEMENT_BADGES: BadgeKey[] = ['owner', 'general_manager', 'manager']

/** The admin-access chip. Distinct from the `owner` job title above: someone
 *  can hold admin rights without being an owner of the business (a general
 *  manager), and an owner can appear publicly without it. */
export const PERMISSION_META: BadgeMeta = {
  key: 'permissions', he: 'הרשאות', en: 'Admin', ar: 'صلاحيات',
  emoji: '🔑', color: '#ff8a5c',
}

/** Which half of the roster someone belongs in. NOT an authorization check —
 *  never gate anything on this; `isOp`/`canEditMenu` in lib/staff/access.ts are
 *  the only things that decide what a person may do. This exists so the roster
 *  can be read in two passes instead of one long list.
 *
 *  `role === 'owner'` counts too: someone holding admin rights with no job
 *  title set is, in practice, management — filing them under עובדים would put
 *  the most powerful account in the list nobody scrolls to the bottom of. */
export function isManagement(row: { role?: string | null; badge?: string | null }): boolean {
  if (row.role === 'owner') return true
  return !!row.badge && (MANAGEMENT_BADGES as string[]).includes(row.badge)
}

function freeText(badge: string): BadgeMeta {
  return { key: badge, he: badge, en: badge, ar: badge, emoji: '👤', color: '#a8a5b0' }
}

const STAFF_FALLBACK: BadgeMeta = {
  key: 'staff', he: 'צוות', en: 'Staff', ar: 'طاقم', emoji: '👤', color: '#a8a5b0',
}

/** Resolve a stored badge to display meta. The job title is now always the job
 *  title — admin access is rendered as its own "הרשאות" chip beside it, so the
 *  two never overwrite each other. Free text is supported so the owner can
 *  label someone "Dev" or anything else the presets don't cover. */
export function badgeMeta(badge: string | null | undefined, role: string): BadgeMeta {
  if (badge && badge in BADGES) return BADGES[badge as BadgeKey]
  if (badge) return freeText(badge)
  if (role === 'owner') return BADGES.owner
  return STAFF_FALLBACK
}
