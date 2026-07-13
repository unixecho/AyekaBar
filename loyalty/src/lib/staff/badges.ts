// Staff job-title badges. `role` (staff | owner) is the authorization level;
// `badge` here is the display job title the owner assigns. Extendable — the
// owner UI also allows a custom badge, which falls back to neutral styling.

export type BadgeKey = 'owner' | 'manager' | 'bartender' | 'waiter' | 'cook' | 'receptionist'

export interface BadgeMeta {
  key: string
  he: string
  en: string
  emoji: string
  /** accent color (hex) used for the chip text/border */
  color: string
}

export const BADGES: Record<BadgeKey, BadgeMeta> = {
  owner:        { key: 'owner',        he: 'בעלים',          en: 'Owner',        emoji: '⭐', color: '#ff8a5c' },
  manager:      { key: 'manager',      he: 'אחראי/ת משמרת',  en: 'Manager',      emoji: '🗂️', color: '#f472b6' },
  bartender:    { key: 'bartender',    he: 'ברמן/ית',        en: 'Bartender',    emoji: '🍸', color: '#c084fc' },
  waiter:       { key: 'waiter',       he: 'מלצר/ית',        en: 'Waiter',       emoji: '🍽️', color: '#60a5fa' },
  cook:         { key: 'cook',         he: 'טבח/ית',         en: 'Cook',         emoji: '👨‍🍳', color: '#fbbf24' },
  receptionist: { key: 'receptionist', he: 'מארח/ת',         en: 'Host',         emoji: '🛎️', color: '#2dd4bf' },
}

/** Selectable presets in the owner UI (owner badge is implied by role, not picked). */
export const BADGE_OPTIONS: BadgeMeta[] = [
  BADGES.manager, BADGES.bartender, BADGES.waiter, BADGES.cook, BADGES.receptionist,
]

/** Resolve a stored badge string (may be a preset key or free text) to display meta. */
export function badgeMeta(badge: string | null | undefined, role: string): BadgeMeta {
  if (role === 'owner') return BADGES.owner
  if (badge && badge in BADGES) return BADGES[badge as BadgeKey]
  if (badge) return { key: badge, he: badge, en: badge, emoji: '👤', color: '#a8a5b0' }
  return { key: 'staff', he: 'צוות', en: 'Staff', emoji: '👤', color: '#a8a5b0' }
}
