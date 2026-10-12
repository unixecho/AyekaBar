// Seed data a venue's shift_settings starts from — overwritten freely by the
// settings screens (ManagerPanel / CatalogEditor), not runtime-hardcoded logic.
// Nothing in the module reads these constants at runtime except when a venue's
// first settings row is created, or while a venue has an empty catalog.
//
// SEEDING ONLY: a venue that already exists carries its own roles, stations and
// templates in `shift_settings`, and that row is what every live surface renders.
// Changing an entry here does NOT rename anything for Ayeka Bar.
//
// `id` is a foreign key in all but name: `shift_assignments.role_id` and every
// `requirements[].roleId` point at it. Rename the `name`, never the `id` — an id
// change orphans existing assignments silently.

import type { SafetyRules, ShiftPreset, ShiftRole, Station } from './types'

/** The one venue that exists today (the row seeded by migration 027). A second
 *  bar is a second `venues` row — the database already scopes everything by it. */
export const AYEKA_VENUE = {
  slug: 'ayeka-bar',
  name: 'אייכה בר',
  timezone: 'Asia/Jerusalem',
} as const

// Roles. Keys mirror BADGE_OPTIONS in lib/staff/badges.ts wherever a job title
// already exists, so assigning someone to a shift can suggest the role they
// actually hold. `shift_leader` maps to the `manager` badge (אחראי/ת משמרת).
export const DEFAULT_ROLES: ShiftRole[] = [
  { id: 'shift_leader', name: 'אחראי/ת משמרת', color: '#f472b6', emoji: '🗂️', badge: 'manager' },
  { id: 'bartender', name: 'ברמן/ית', color: '#c084fc', emoji: '🍸', badge: 'bartender' },
  { id: 'waiter', name: 'מלצר/ית', color: '#60a5fa', emoji: '🍽️', badge: 'waiter' },
  { id: 'kitchen', name: 'טבח/ית', color: '#fbbf24', emoji: '👨‍🍳', badge: 'cook' },
  { id: 'busboy', name: 'עוזר/ת טבח', color: '#a3e635', emoji: '🔪', badge: 'busboy' },
  { id: 'host', name: 'מארח/ת', color: '#2dd4bf', emoji: '🛎️', badge: 'receptionist' },
]

// Stations. Deliberately NOT derived from `waiter_tables.zone`: that table
// describes where GUESTS sit, a station describes where a WORKER stands.
export const DEFAULT_STATIONS: Station[] = [
  { id: 'main_bar', name: 'בר ראשי', emoji: '🍹', roleIds: ['bartender', 'shift_leader'] },
  { id: 'patio', name: 'פטיו / חוץ', emoji: '🌙', roleIds: ['waiter', 'host'] },
  { id: 'floor', name: 'אולם פנימי', emoji: '🪑', roleIds: ['waiter'] },
  { id: 'kitchen', name: 'מטבח', emoji: '🔥', roleIds: ['kitchen'] },
  { id: 'closing', name: 'סגירה', emoji: '🧹' },
]

// Shift templates. A bar's day, not an office's: the early block is setup rather
// than "morning", and both evening blocks cross midnight. A template may also
// carry the staffing a shift made from it starts with.
export const DEFAULT_PRESETS: ShiftPreset[] = [
  {
    id: 'prep', name: 'הכנה', startTime: '15:00', endTime: '19:00', stationId: 'main_bar', color: '#38e1ff',
    requirements: [{ roleId: 'bartender', min: 1 }],
  },
  {
    id: 'evening', name: 'ערב', startTime: '18:00', endTime: '01:00', stationId: 'main_bar', color: '#ff8a5c',
    requirements: [
      { roleId: 'shift_leader', min: 1, max: 1 },
      { roleId: 'bartender', min: 2 },
      { roleId: 'waiter', min: 2 },
    ],
  },
  {
    id: 'night', name: 'לילה', startTime: '21:00', endTime: '03:00', stationId: 'main_bar', color: '#c084fc',
    requirements: [
      { roleId: 'shift_leader', min: 1, max: 1 },
      { roleId: 'bartender', min: 2 },
      { roleId: 'waiter', min: 1 },
    ],
  },
]

export const DEFAULT_SAFETY: SafetyRules = {
  maxWeeklyHours: 42,
  minRestHours: 8,
  maxDailyHours: 12,
  maxConsecutiveDays: 6,
}

/** UI slider/stepper bounds — keeps the owner from typing in a value the
 *  rules engine would treat as nonsensical (e.g. a rest period longer than a day). */
export const SAFETY_BOUNDS = {
  maxWeeklyHours: { min: 10, max: 80, step: 1 },
  minRestHours: { min: 0, max: 16, step: 0.5 },
  maxDailyHours: { min: 4, max: 16, step: 0.5 },
  maxConsecutiveDays: { min: 1, max: 10, step: 1 },
} as const

export function hoursForDay(
  dayOfWeek: number,
  openTime: string,
  closeTime: string,
  dayHours: Record<number, { open: string; close: string }>
): { open: string; close: string } {
  return dayHours[dayOfWeek] ?? { open: openTime, close: closeTime }
}

/** Palette offered when the manager adds a template or a role. Drawn from the
 *  app's existing accents rather than a fresh set — one visual language. */
export const ACCENT_COLORS = [
  '#ff5e3a', '#ff8a5c', '#fb7185', '#f472b6', '#c084fc',
  '#60a5fa', '#38e1ff', '#2dd4bf', '#4ade80', '#fbbf24',
]
