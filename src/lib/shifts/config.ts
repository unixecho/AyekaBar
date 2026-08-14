// Defaults and the seeded venue.
//
// Everything here is a STARTING POINT the Manager Panel overwrites — nothing in
// the module reads these constants at runtime except when creating a venue's
// first settings row. That is the difference between a default and a
// hard-coded rule, and it is why the safety numbers below are advisory rather
// than authoritative: Israeli hospitality practice, not law, and the manager
// moves them.

import type {
  FeatureFlags, HM, SafetyRules, ShiftPreset, ShiftRole, ShiftSettings, Station, Venue,
} from './types'

/** The one venue that exists today. A second bar is a second row here — no
 *  schema change, no code change, which is the whole point of venueId. */
export const AYEKA_VENUE: Venue = {
  id: 'venue-ayeka',
  slug: 'ayeka-bar',
  name: { he: 'אייכה בר', en: 'Ayeka Bar', ar: 'بار أييكا' },
  timezone: 'Asia/Jerusalem',
  weekStartsOn: 0, // Sunday — the Israeli working week
}

// ── Roles ──────────────────────────────────────────────────────────────
// Keys mirror `BADGE_OPTIONS` in lib/staff/badges.ts wherever a job title
// already exists, so assigning someone to a shift can suggest the role they
// actually hold. `shift_leader` is the exception: it maps to the `manager`
// badge (אחראי/ת משמרת), which is that badge's literal meaning.

export const DEFAULT_ROLES: ShiftRole[] = [
  { id: 'shift_leader', name: { he: 'אחראי/ת משמרת', en: 'Shift Leader', ar: 'مسؤول/ة الوردية' }, emoji: '🗂️', color: '#f472b6', badge: 'manager' },
  { id: 'bartender',    name: { he: 'ברמן/ית',        en: 'Bartender',    ar: 'نادل/ة بار' },      emoji: '🍸', color: '#c084fc', badge: 'bartender' },
  { id: 'waiter',       name: { he: 'מלצר/ית',        en: 'Waiter',       ar: 'نادل/ة' },          emoji: '🍽️', color: '#60a5fa', badge: 'waiter' },
  { id: 'kitchen',      name: { he: 'מטבח',           en: 'Kitchen',      ar: 'مطبخ' },            emoji: '👨‍🍳', color: '#fbbf24', badge: 'cook' },
  { id: 'host',         name: { he: 'מארח/ת',         en: 'Host',         ar: 'مضيف/ة' },          emoji: '🛎️', color: '#2dd4bf', badge: 'receptionist' },
]

// ── Stations ───────────────────────────────────────────────────────────
// Deliberately NOT derived from `waiter_tables.zone`. That table belongs to the
// staff ordering app (see STAFF_APP.md) and describes where GUESTS sit; a
// station describes where a WORKER stands, and "Closing Prep" is a station with
// no tables at all. Reading across that boundary would couple two apps that are
// documented as independent.

export const DEFAULT_STATIONS: Station[] = [
  { id: 'main_bar', name: { he: 'בר ראשי',   en: 'Main Bar',     ar: 'البار الرئيسي' }, emoji: '🍹', roleIds: ['bartender', 'shift_leader'] },
  { id: 'patio',    name: { he: 'פטיו / חוץ', en: 'Patio',        ar: 'الفناء' },        emoji: '🌙', roleIds: ['waiter', 'host'] },
  { id: 'floor',    name: { he: 'אולם פנימי', en: 'Inside Floor', ar: 'الصالة' },        emoji: '🪑', roleIds: ['waiter'] },
  { id: 'kitchen',  name: { he: 'מטבח',       en: 'Kitchen',      ar: 'مطبخ' },          emoji: '🔥', roleIds: ['kitchen'] },
  { id: 'closing',  name: { he: 'סגירה',      en: 'Closing Prep', ar: 'إغلاق' },         emoji: '🧹' },
]

// ── Shift presets ──────────────────────────────────────────────────────
// A bar's day, not an office's: the early block is setup rather than "morning",
// and both evening blocks cross midnight.

export const DEFAULT_PRESETS: ShiftPreset[] = [
  {
    id: 'prep', name: { he: 'הכנה', en: 'Prep', ar: 'تحضير' },
    start: '15:00', end: '19:00', color: '#38e1ff', stationId: 'main_bar',
    requirements: [{ roleId: 'bartender', min: 1 }],
  },
  {
    id: 'evening', name: { he: 'ערב', en: 'Evening', ar: 'مساء' },
    start: '18:00', end: '01:00', color: '#ff8a5c', stationId: 'main_bar',
    requirements: [
      { roleId: 'shift_leader', min: 1, max: 1 },
      { roleId: 'bartender', min: 2 },
      { roleId: 'waiter', min: 2 },
    ],
  },
  {
    id: 'night', name: { he: 'לילה', en: 'Night', ar: 'ليل' },
    start: '21:00', end: '03:00', color: '#c084fc', stationId: 'main_bar',
    requirements: [
      { roleId: 'shift_leader', min: 1, max: 1 },
      { roleId: 'bartender', min: 2 },
      { roleId: 'waiter', min: 1 },
    ],
  },
]

// ── Safety rules ───────────────────────────────────────────────────────

export const DEFAULT_SAFETY: SafetyRules = {
  maxWeeklyHours: 42,
  minRestHours: 8,
  maxDailyHours: 12,
  maxConsecutiveDays: 6,
}

/** Slider bounds for the panel. Kept beside the defaults so the UI can never
 *  offer a value the rules engine treats as nonsense (a zero-hour week, a rest
 *  period longer than a day). */
export const SAFETY_BOUNDS: Record<keyof SafetyRules, { min: number; max: number; step: number }> = {
  maxWeeklyHours:     { min: 10, max: 80, step: 1 },
  minRestHours:       { min: 0,  max: 16, step: 1 },
  maxDailyHours:      { min: 4,  max: 16, step: 1 },
  maxConsecutiveDays: { min: 1,  max: 7,  step: 1 },
}

// ── Feature flags ──────────────────────────────────────────────────────
// Both OFF for Ayeka Bar, per the brief. They are venue settings rather than
// environment variables on purpose: a second venue may want availability on
// from day one, and the manager must be able to flip it without a deploy —
// exactly how `app_settings.loyalty_enabled` already works for the club.

export const DEFAULT_FEATURES: FeatureFlags = {
  ENABLE_AVAILABILITY_SUBMISSIONS: false,
  ENABLE_SHIFT_SWAPS: false,
}

export function defaultSettings(venueId: string): ShiftSettings {
  return {
    venueId,
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    openTime: '17:00',
    closeTime: '03:00',
    // Empty, not pre-filled with a guess at Friday/Saturday's actual hours —
    // "short days by design" is real but venue-specific, and defaultSettings
    // exists to be a starting point the manager overwrites, never a
    // hard-coded rule (see this file's header). The Manager Panel is where
    // Friday and Saturday actually get set.
    dayHours: {},
    presets: DEFAULT_PRESETS,
    roles: DEFAULT_ROLES,
    stations: DEFAULT_STATIONS,
    safety: DEFAULT_SAFETY,
    features: DEFAULT_FEATURES,
    scheduleManagers: [],
    onboardedAt: null,
  }
}

/** The operating window for one weekday — `dayHours[weekday]` if the manager
 *  set one, otherwise the venue default. The single place both the rules
 *  engine and the panel resolve "what hours does Thursday actually run",
 *  so they cannot read that question two different ways. */
export function hoursForDay(settings: ShiftSettings, weekday: number): { open: HM; close: HM } {
  // Optional-chained: a browser session persisted before dayHours existed
  // (this is a localStorage prototype, not a real migration system — see
  // mock.ts's restore()) has no such key at all, not an empty object.
  const override = settings.dayHours?.[weekday]
  return override ?? { open: settings.openTime, close: settings.closeTime }
}

/** Palette offered when the manager adds a preset or a role. Drawn from the
 *  app's existing accents rather than a fresh set — one visual language. */
export const ACCENTS = [
  '#ff5e3a', '#ff8a5c', '#fb7185', '#f472b6', '#c084fc',
  '#60a5fa', '#38e1ff', '#2dd4bf', '#4ade80', '#fbbf24',
]
