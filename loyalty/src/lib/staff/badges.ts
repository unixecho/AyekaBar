// Staff job-title badges. `role` (staff | owner) is the authorization level;
// `badge` here is the display job title the owner assigns. Extendable — the
// owner UI also allows a custom badge, which falls back to neutral styling.
//
// These strings are user-facing on the public /team page, so every badge
// carries he/en/ar like the rest of the app.

export type BadgeKey =
  | 'owner' | 'general_manager' | 'manager'
  | 'bartender' | 'waiter' | 'cook' | 'receptionist'

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
  receptionist:    { key: 'receptionist',    he: 'מארח/ת',         en: 'Host',            ar: 'مضيف/ة',          emoji: '🛎️', color: '#2dd4bf' },
}

/** Selectable presets in the owner UI (owner badge is implied by role, not picked). */
export const BADGE_OPTIONS: BadgeMeta[] = [
  BADGES.general_manager, BADGES.manager, BADGES.bartender,
  BADGES.waiter, BADGES.cook, BADGES.receptionist,
]

function freeText(badge: string): BadgeMeta {
  return { key: badge, he: badge, en: badge, ar: badge, emoji: '👤', color: '#a8a5b0' }
}

const STAFF_FALLBACK: BadgeMeta = {
  key: 'staff', he: 'צוות', en: 'Staff', ar: 'طاقم', emoji: '👤', color: '#a8a5b0',
}

/** Resolve a stored badge to display meta for the OWNER's roster, where
 *  ownership is the thing that matters — an owner always reads as "בעלים" so
 *  the owner can see at a glance who holds admin rights. */
export function badgeMeta(badge: string | null | undefined, role: string): BadgeMeta {
  if (role === 'owner') return BADGES.owner
  if (badge && badge in BADGES) return BADGES[badge as BadgeKey]
  if (badge) return freeText(badge)
  return STAFF_FALLBACK
}

/** Resolve a badge for the PUBLIC team page, where the job title is what a
 *  visitor cares about: a co-owner who runs the floor should read as "General
 *  Manager", not have it replaced by the ownership star. Falls back to owner
 *  when no job title was ever assigned. */
export function publicBadgeMeta(badge: string | null | undefined, role: string): BadgeMeta {
  if (badge && badge in BADGES) return BADGES[badge as BadgeKey]
  if (badge) return freeText(badge)
  if (role === 'owner') return BADGES.owner
  return STAFF_FALLBACK
}
