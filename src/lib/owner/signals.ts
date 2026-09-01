// What the dashboard notices. Server-only (service-role reads), imported from
// the OP-gated /owner/dashboard page and nothing else.
//
// ── The rule this module exists to enforce ─────────────────────────────
// A row appears ONLY when it is true right now. There is no "all clear"
// state, no empty list, no zeroed-out card — when nothing is wrong the
// dashboard renders no stack at all. That silence is the whole mechanism:
// a panel that is always present becomes furniture within a week, and the
// one night it says something real, nobody reads it.
//
// The corollary, and the reason several reads below are fussier than they
// look: a signal that fires when nothing is wrong destroys the mechanism
// just as surely as one that never fires. Two of them were rewritten during
// review for exactly that (see readMenu and readSchedule).
//
// ── Failure posture ───────────────────────────────────────────────────
// Every read is independent and every one of them is allowed to fail. A
// broken query drops its own signal and nothing else — the dashboard is the
// first screen the owner opens, and it must render even when half the
// database is unreachable. Nothing here throws.
//
// A failed read must never surface as a confident zero. Every stat carries a
// `known` flag and the strip renders "—" when it is false: "no tabs are open"
// and "I could not read the orders table" are opposite facts, and the
// confident zero is the one that gets somebody into trouble.
//
// ── Why service-role ──────────────────────────────────────────────────
// These are cross-staff, cross-table aggregates: RLS deliberately lets a
// signed-in user read only their own staff row, only their own shifts. The
// page that calls this has already established the caller is OP, which is
// the same posture /api/owner/staff takes.

import { createServiceClient } from '@/lib/supabase/server'
import { MENU_SLUG, type MenuCategory } from '@/lib/menu/types'
import {
  OMS_OVERALL_DEMO_MODE,
  ACCESSIBILITY_STATEMENT, ACCESSIBILITY_REQUIRED_TEXT_FIELDS, type AccessibilityStatement,
} from '@/lib/settings/keys'
import { AYEKA_VENUE, DEFAULT_ROLES } from '@/lib/shifts/config'
import { todayIn, addDays, dayIndex, intervalOf, nowMinutesIn } from '@/lib/shifts/time'

// ── Tunables ──────────────────────────────────────────────────────────
// Named, because every one of them is a judgement call somebody will want to
// move after a week of real service rather than a fact about the business.

/** An item sent to the bar/kitchen and still not ready after this long has
 *  stopped being "in progress" and started being a complaint. */
export const STUCK_ITEM_MINUTES = 12

/** Ignore anything sent longer ago than this. A row left mid-flight by a
 *  crash or a test months back is not news, and without this floor it would
 *  light the alert up permanently — which trains the owner to ignore it. */
export const STUCK_ITEM_MAX_AGE_HOURS = 24

/** A shift session open longer than this was not ended, not still running.
 *  Deliberately generous: a bar's night legitimately runs long. */
export const SHIFT_OPEN_HOURS = 14

/** Item states that mean "a station owes somebody this and has not delivered
 *  it". `preparing` matters as much as `sent` — arguably more: it is the item
 *  a human already picked up and then dropped, which is the actual complaint
 *  case. Leaving it out inverted the alert, flagging untouched items while
 *  staying silent on abandoned ones. (Full lifecycle, per the CHECK on
 *  waiter_order_items: registered → sent → preparing → ready → delivered,
 *  plus voided.)
 *
 *  Exported so signal-details.ts's drill-down query filters on the EXACT
 *  same statuses/thresholds this count does — two copies of this list would
 *  eventually drift, and a dashboard whose expanded view shows a different
 *  count than the number above it is worse than not expanding at all. */
export const IN_FLIGHT_ITEM_STATUSES = ['sent', 'preparing']

/** How many out-of-stock item names to name before "ועוד N". */
const NAME_PREVIEW = 2

// ── Types ─────────────────────────────────────────────────────────────

export type SignalSeverity = 'critical' | 'warning' | 'info'

export interface DashboardSignal {
  id: string
  severity: SignalSeverity
  /** Higher sorts first. Fixed per signal so the stack's order never jitters
   *  between two loads with the same contents.
   *
   *  BANDED BY SEVERITY: critical ≥ 80, warning 40–79, info < 40. The bands
   *  are what let the stack header state the worst severity present without
   *  re-sorting, and they keep a warning from ever outranking a critical. Add
   *  a signal inside its band. */
  rank: number
  icon: string
  title: string
  detail?: string
  /** Where the action button goes. Absent for `demo-off`, which acts in place. */
  href?: string
  actionLabel: string
  /** `demo-off` renders an inline switch instead of a link — the fix for that
   *  row is one tap, and bouncing to another page to make it would be worse. */
  kind: 'link' | 'demo-off'
}

export interface DashboardStats {
  /** Open tabs, not physical tables — a quick purchase has no table at all and
   *  two combined tables share one tab. See readFloor(). */
  openTabs: number
  floorAgorot: number
  /** False when the orders read failed. */
  floorKnown: boolean
  stuckItems: number
  stuckKnown: boolean
  /** People — distinct — the published schedule has on today. */
  scheduledToday: number
  scheduleKnown: boolean
}

export interface DashboardSignals {
  stats: DashboardStats
  signals: DashboardSignal[]
}

const EMPTY_STATS: DashboardStats = {
  openTabs: 0, floorAgorot: 0, floorKnown: false,
  stuckItems: 0, stuckKnown: false,
  scheduledToday: 0, scheduleKnown: false,
}

// ── Individual reads ──────────────────────────────────────────────────
// Each returns its own slice. Each swallows its own errors.

type Service = ReturnType<typeof createServiceClient>

/** Draft-vs-published divergence, and what is marked out of stock.
 *
 *  These two travel together on purpose. Out-of-stock is a flag on the DRAFT
 *  (`menus.draft.categories[].items[].available === false`); customers read
 *  `published`. Marking six items אזל and walking away changes nothing at all
 *  for a guest — so the unpublished-changes signal outranks the stock one, and
 *  both are computed from the same single row read.
 *
 *  ── Why this compares CONTENT and not timestamps ────────────────────
 *  The obvious test, `updated_at > published_at`, is broken here and was
 *  caught in review. `menus.updated_at` is written by the BROWSER
 *  (MenuEditor.save() sends `new Date().toISOString()` from a client
 *  component) while `published_at` is written by POSTGRES inside
 *  publish_menu() — which never touches updated_at — and there is no
 *  updated_at trigger on the table. The two values come off different clocks.
 *  An owner whose tablet runs a minute fast would pin the loudest row in the
 *  stack permanently ON immediately after a perfectly successful publish; a
 *  tablet running slow would keep it silent while customers read a stale menu.
 *
 *  `draft` vs `published` answers the real question — "is what I edited what
 *  they can read?" — with no clock involved. publish_menu() does
 *  `set published = draft`, so the two are byte-identical right after a
 *  publish and differ the moment anything is saved. Both sides are jsonb, so
 *  Postgres has already normalised key order on the way in; comparing the
 *  parsed values is stable. The cost is carrying `published` in the response
 *  as well as `draft` — server-side only, on an owner-gated page. */
async function readMenu(service: Service): Promise<DashboardSignal[]> {
  try {
    const { data, error } = await service
      .from('menus')
      .select('draft, published')
      .eq('slug', MENU_SLUG)
      .maybeSingle()
    if (error || !data) return []

    const out: DashboardSignal[] = []

    // A menu that has never been published is drifted by definition — and it
    // is a louder condition than drift, though it means the same thing to a
    // guest: what you edited is not what they can read.
    const drifted = data.draft != null
      && JSON.stringify(data.draft) !== JSON.stringify(data.published ?? null)

    const cats = (data.draft?.categories as MenuCategory[] | undefined) ?? []
    const soldOut = cats.flatMap((cat) =>
      (cat.items ?? [])
        .filter((item) => item.available === false)
        .map((item) => item.he || item.en || item.ar || '—')
    )

    if (drifted) {
      out.push({
        id: 'menu-unpublished',
        severity: 'critical',
        rank: 80,
        icon: '📢',
        title: 'שינויים בתפריט לא פורסמו',
        detail: 'הלקוחות עדיין רואים את הגרסה הקודמת — כולל פריטים שסומנו כאזלו',
        href: '/owner/editor',
        actionLabel: 'לתפריט',
        kind: 'link',
      })
    }

    if (soldOut.length > 0) {
      const named = soldOut.slice(0, NAME_PREVIEW).join(', ')
      const rest = soldOut.length - NAME_PREVIEW
      out.push({
        id: 'menu-out-of-stock',
        severity: 'warning',
        rank: 60,
        icon: '⚠️',
        title: soldOut.length === 1
          ? 'פריט אחד אזל מהמלאי'
          : `${soldOut.length} פריטים אזלו מהמלאי`,
        detail: rest > 0 ? `${named}, ועוד ${rest}` : named,
        href: '/owner/editor#out-of-stock',
        actionLabel: 'להחזרה למלאי',
        kind: 'link',
      })
    }

    return out
  } catch {
    return []
  }
}

const ACCESSIBILITY_FIELD_LABELS: Record<keyof AccessibilityStatement, string> = {
  entranceAccess: 'נגישות הכניסה', restroomAccess: 'נגישות השירותים',
  generalNote: 'הערה כללית', browsersTested: 'דפדפנים שנבדקו',
  contactName: 'שם איש קשר', contactPhone: 'טלפון', contactEmail: 'אימייל', exemptionNote: 'פטור',
}

/** 2026-09-01: "don't show the customer any missing information... every
 *  missing field surfaces in the dashboard notification bar as input that
 *  needs to be entered." The public /accessibility page already renders
 *  only whatever's filled in — this is the other half, telling the owner
 *  what's still blank rather than leaving that silent. Info-tier: an
 *  incomplete compliance document is a real gap, but not an operational
 *  emergency the way a stuck order is. */
async function readAccessibility(service: Service): Promise<DashboardSignal | null> {
  try {
    const { data, error } = await service
      .from('app_settings')
      .select('value')
      .eq('key', ACCESSIBILITY_STATEMENT)
      .maybeSingle()
    if (error) return null

    const value = (data?.value as AccessibilityStatement | undefined) ?? {}
    const missing = ACCESSIBILITY_REQUIRED_TEXT_FIELDS.filter((k) => !value[k]?.trim())
    // Contact info needs at least one channel, not literally both fields.
    if (!value.contactPhone?.trim() && !value.contactEmail?.trim()) {
      missing.push('contactPhone')
    }
    if (missing.length === 0) return null

    const names = missing.map((k) => ACCESSIBILITY_FIELD_LABELS[k] ?? k)
    return {
      id: 'accessibility-incomplete',
      severity: 'info',
      rank: 20,
      icon: '♿',
      title: 'הצהרת הנגישות חסרה פרטים',
      detail: names.join(', '),
      href: '/owner/accessibility',
      actionLabel: 'להשלמה',
      kind: 'link',
    }
  } catch {
    return null
  }
}

/** Open tabs: how many, and how much money is sitting on the floor.
 *
 *  TABS, NOT TABLES. The count used to be labelled "שולחנות פתוחים" and it was
 *  wrong in both directions: a `quick_purchase` order carries no table at all
 *  (migration 033), and two tables combined onto one order (migration 032) are
 *  two occupied tables behind a single row. Counting tabs is both what this
 *  query actually measures and the figure the money belongs to, so the label
 *  moved to match rather than the query growing two joins to defend a word.
 *
 *  `total_agorot` is maintained live as items are registered (verified against
 *  the item sums on production), so this stays one cheap read. */

/** A tab still on the floor. Exported so signal-details.ts's drill-down
 *  query filters on the EXACT same statuses this count does — see
 *  IN_FLIGHT_ITEM_STATUSES's own comment for why that matters. */
export const OPEN_TAB_STATUSES = ['open', 'filed']

async function readFloor(service: Service): Promise<{
  openTabs: number; floorAgorot: number; known: boolean
}> {
  try {
    const { data, error } = await service
      .from('waiter_orders')
      .select('total_agorot')
      .in('status', OPEN_TAB_STATUSES)
    if (error || !data) return { openTabs: 0, floorAgorot: 0, known: false }
    return {
      openTabs: data.length,
      floorAgorot: data.reduce((sum, o) => sum + (o.total_agorot ?? 0), 0),
      known: true,
    }
  } catch {
    return { openTabs: 0, floorAgorot: 0, known: false }
  }
}

/** Items a station owes somebody and has not delivered. */
async function readStuckItems(service: Service): Promise<{
  count: number; known: boolean; signal: DashboardSignal | null
}> {
  try {
    const cutoff = new Date(Date.now() - STUCK_ITEM_MINUTES * 60_000).toISOString()
    const floor = new Date(Date.now() - STUCK_ITEM_MAX_AGE_HOURS * 3_600_000).toISOString()

    const { data, error } = await service
      .from('waiter_order_items')
      .select('station, sent_at')
      .in('status', IN_FLIGHT_ITEM_STATUSES)
      .is('ready_at', null)
      .lt('sent_at', cutoff)
      .gt('sent_at', floor)
    if (error || !data) return { count: 0, known: false, signal: null }
    if (data.length === 0) return { count: 0, known: true, signal: null }

    // The oldest one is the number that actually matters — "3 items waiting"
    // is much less useful than knowing one has been waiting 26 minutes.
    // Seeded from Date.now() so an unparseable sent_at can only ever fail
    // toward "0 minutes", never toward a fabricated age.
    const oldest = data.reduce((max, r) => {
      const t = r.sent_at ? Date.parse(r.sent_at) : NaN
      return Number.isFinite(t) && t < max ? t : max
    }, Date.now())
    const waited = Math.round((Date.now() - oldest) / 60_000)

    return {
      count: data.length,
      known: true,
      signal: {
        id: 'oms-stuck-items',
        severity: 'warning',
        rank: 70,
        icon: '⏱️',
        title: data.length === 1
          ? 'פריט אחד ממתין במעבר'
          : `${data.length} פריטים ממתינים במעבר`,
        detail: `הוותיק ביותר — ${waited} דק׳ מאז שנשלח`,
        href: '/owner/reports',
        actionLabel: 'לפירוט',
        kind: 'link',
      },
    }
  } catch {
    return { count: 0, known: false, signal: null }
  }
}

/** How long before a scheduled shift starts this signal starts mentioning
 *  it — "give a reminder on the dashboard 30 minutes before the shift
 *  should start," 2026-08-30. */
export const SHIFT_REMINDER_MINUTES = 30

/** "The dashboard should prompt the user to start the shift" — two distinct
 *  moments, not one signal reused: a reminder ahead of time (warning — there
 *  is still time to act) and a "you're already late" alert once the planned
 *  start has passed with nobody having opened (critical — actively wrong
 *  right now). Silent whenever a session is already active — a schedule
 *  that says 19:00 and a shift that opened at 18:50 needs no comment at all.
 *  Silent again once the shift's whole planned WINDOW has elapsed, so this
 *  never nags about a shift the day has already moved past. */
async function readShiftReminder(service: Service): Promise<DashboardSignal | null> {
  try {
    const { data: active } = await service
      .from('waiter_shift_sessions').select('id').eq('status', 'active').maybeSingle()
    if (active) return null

    const { today, shifts, known } = await readTodayShifts(service)
    if (!known) return null

    const tz = AYEKA_VENUE.timezone
    const nowAbs = dayIndex(today) * 1440 + nowMinutesIn(tz)

    // The earliest TODAY shift whose planned window hasn't fully elapsed yet.
    let earliest: { start: string; startAbs: number; endAbs: number } | null = null
    for (const s of shifts) {
      if (s.date !== today || !s.start) continue
      const interval = intervalOf(s.date, s.start, s.end || s.start)
      if (interval.end <= nowAbs) continue
      if (earliest && interval.start >= earliest.startAbs) continue
      earliest = { start: s.start, startAbs: interval.start, endAbs: interval.end }
    }
    if (!earliest) return null

    const minutesUntil = earliest.startAbs - nowAbs
    if (minutesUntil > SHIFT_REMINDER_MINUTES) return null

    if (minutesUntil > 0) {
      return {
        id: 'shift-starting-soon',
        severity: 'warning',
        rank: 65,
        icon: '⏰',
        title: `המשמרת מתחילה בעוד ${minutesUntil} דק׳`,
        detail: `שעת פתיחה מתוכננת: ${earliest.start} — לא נשכח לפתוח`,
        href: '/owner/reports',
        actionLabel: 'לפתיחת משמרת',
        kind: 'link',
      }
    }

    // Past the planned start, still inside the planned window, nobody's
    // opened it — this is the loud one.
    return {
      id: 'shift-not-started',
      severity: 'critical',
      rank: 90,
      icon: '🚨',
      title: 'המשמרת הייתה אמורה להתחיל ולא נפתחה',
      detail: `שעת פתיחה מתוכננת: ${earliest.start}`,
      href: '/owner/reports',
      actionLabel: 'לפתיחת משמרת',
      kind: 'link',
    }
  } catch {
    return null
  }
}

/** A shift session someone forgot to end. */
async function readShiftSession(service: Service): Promise<DashboardSignal | null> {
  try {
    const { data, error } = await service
      .from('waiter_shift_sessions')
      .select('started_at')
      .eq('status', 'active')
      .order('started_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (error || !data?.started_at) return null

    const hours = (Date.now() - Date.parse(data.started_at)) / 3_600_000
    if (!Number.isFinite(hours) || hours < SHIFT_OPEN_HOURS) return null

    return {
      id: 'oms-shift-open',
      severity: 'warning',
      rank: 50,
      icon: '🕐',
      title: 'משמרת נשארה פתוחה',
      detail: `פתוחה כבר ${Math.floor(hours)} שעות — דוח הסיום לא הופק`,
      href: '/owner/reports',
      // Short on purpose. The action chip is nowrap and sits beside a title
      // that already wraps on a phone; "לקבלות ומשמרות" ate half the row.
      actionLabel: 'לדוחות',
      kind: 'link',
    }
  } catch {
    return null
  }
}

/** Exported so callers can tell "is the Overall-view demo mode on" straight
 *  from a signals array (`signals.some(s => s.id === OVERALL_DEMO_SIGNAL_ID)`)
 *  instead of a second, separate read — see page.tsx and DashboardLive.tsx,
 *  2026-08-30. Guarantees the switch and the alert can never read two
 *  different answers, since there is only ever the one read. */
export const OVERALL_DEMO_SIGNAL_ID = 'oms-demo-mode'

/** Demo mode on the Overall view. Read straight rather than through
 *  getOverallDemoMode() so a stale 60s cache entry can't tell the owner the
 *  deck is safe while it is live — this is the one switch where guessing
 *  wrong during service costs a real order. */
async function readDemoMode(service: Service): Promise<DashboardSignal | null> {
  try {
    const { data, error } = await service
      .from('app_settings')
      .select('value')
      .eq('key', OMS_OVERALL_DEMO_MODE)
      .maybeSingle()
    if (error || data?.value !== true) return null

    return {
      id: OVERALL_DEMO_SIGNAL_ID,
      severity: 'critical',
      rank: 100,
      icon: '🎭',
      title: 'מצב הדגמה פעיל',
      detail: 'תצוגת העל כותבת על נתונים אמיתיים — לכבות לפני משמרת',
      actionLabel: 'כיבוי',
      kind: 'demo-off',
    }
  } catch {
    return null
  }
}

/** The snapshot a published week froze. Mirrors `rowToPublishedWeek`'s input
 *  in lib/shifts/serialize.ts — kept local and minimal because this module
 *  only needs staffing counts, not the full domain type. */
export interface SnapshotShift {
  date?: string
  start?: string
  end?: string
  // Frozen alongside roleId/staffId at publish time — the snapshot already
  // carries a display name, so a "who's on today" drill-down needs no
  // separate staff lookup at all (see signal-details.ts's readScheduledToday).
  assignments?: { roleId?: string; staffId?: string | null; staffName?: string }[]
  requirements?: { roleId?: string; min?: number }[]
}

/** The active venue's id, today's date string, and every published shift
 *  touching today or tomorrow — shared by readSchedule (the count + gap
 *  signal below) and signal-details.ts's "who's on today" drill-down, so the
 *  two can never disagree about what counts as "today's schedule." `known`
 *  is false only on an actual read failure — a real "nobody published a
 *  week" resolves to `shifts: []` with `known: true`, per this file's own
 *  "never surface a failure as a confident zero" rule. */
export async function readTodayShifts(service: Service): Promise<{
  venueId: string | null; today: string; shifts: SnapshotShift[]; known: boolean
}> {
  const today = todayIn(AYEKA_VENUE.timezone)
  const unknown = { venueId: null, today, shifts: [], known: false }

  const { data: venue, error: venueError } = await service
    .from('venues')
    .select('id')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  // No active venue is folded into "unknown" too, not a confident zero — the
  // original readSchedule treated it that way (an unconfigured venue reads
  // as "can't tell" rather than "definitely nobody's scheduled"), and this
  // helper must not quietly relax that.
  if (venueError || !venue) return unknown

  const tomorrow = addDays(today, 1)

  const { data: weeks, error } = await service
    .from('schedule_weeks')
    .select('published_snapshot')
    .eq('venue_id', venue.id)
    .eq('status', 'published')
  if (error) return unknown

  const shifts: SnapshotShift[] = (weeks ?? []).flatMap((w) => {
    const snap = w.published_snapshot as { shifts?: SnapshotShift[] } | null
    return (snap?.shifts ?? []).filter((s) => s.date === today || s.date === tomorrow)
  })
  return { venueId: venue.id, today, shifts, known: true }
}

/** Today's roster, and any role a published shift is short on.
 *
 *  ── Reads the SNAPSHOT, not the live tables ─────────────────────────
 *  Caught in review, and the distinction is the whole point of the feature.
 *  Publishing a week freezes it into `schedule_weeks.published_snapshot`;
 *  `public.shifts` and `public.shift_assignments` remain the manager-only
 *  DRAFT and keep taking edits after publish. Filtering weeks by
 *  `status = 'published'` and then reading the live tables gave neither one:
 *  a manager could quietly fill a hole in the draft, the dashboard's alert
 *  would clear, and the staff schedule and print sheet would still show the
 *  hole because nobody re-published. The dashboard would be reporting what
 *  one manager typed, while claiming to report what the team believes.
 *
 *  The snapshot carries shifts, their requirements and their assignments in
 *  one row, so this is also a single read instead of three.
 *
 *  `scheduledToday` is the PLANNED roster, not a clock-in count: there is no
 *  honest live count available, since waiter_station_checkins covers
 *  bartenders and cooks only and would silently omit every waiter. It counts
 *  DISTINCT people — one person working a split shift is one person. */
async function readSchedule(service: Service): Promise<{
  scheduledToday: number
  known: boolean
  signal: DashboardSignal | null
}> {
  const miss = { scheduledToday: 0, known: false, signal: null }
  try {
    const { today, shifts, known } = await readTodayShifts(service)
    if (!known) return miss
    if (shifts.length === 0) return { scheduledToday: 0, known: true, signal: null }

    // Distinct PEOPLE on today. A split shift is two assignment rows and one
    // human; so is the same person filling two roles on one shift, which the
    // schema permits (027 makes that a rules-engine warning, not a
    // constraint). staffId is nullable — `on delete set null` — so a row whose
    // person was deleted contributes nothing rather than a phantom head.
    const todayStaff = new Set<string>()
    for (const shift of shifts) {
      if (shift.date !== today) continue
      for (const a of shift.assignments ?? []) {
        if (a.staffId) todayStaff.add(a.staffId)
      }
    }

    // Roles short of their minimum, nearest shift first.
    const gaps: { date: string; start: string; roleId: string; short: number }[] = []
    for (const shift of shifts) {
      const filled = new Map<string, number>()
      for (const a of shift.assignments ?? []) {
        if (!a.roleId) continue
        filled.set(a.roleId, (filled.get(a.roleId) ?? 0) + 1)
      }
      for (const req of shift.requirements ?? []) {
        if (!req.roleId) continue
        const short = (req.min ?? 0) - (filled.get(req.roleId) ?? 0)
        if (short > 0) {
          gaps.push({
            date: shift.date ?? '',
            start: (shift.start ?? '').slice(0, 5),
            roleId: req.roleId,
            short,
          })
        }
      }
    }

    const scheduledToday = todayStaff.size
    if (gaps.length === 0) return { scheduledToday, known: true, signal: null }

    gaps.sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)))
    const first = gaps[0]
    const when = first.date === today ? 'היום' : 'מחר'
    const roleName = roleLabel(first.roleId)

    // "תקנים" promises a count of POSITIONS, so it has to be the sum of the
    // shortfalls — not gaps.length, which counts (shift, role) pairs. Four
    // missing waiters and two missing bartenders is 6 unfilled positions
    // across 2 gaps, and reporting "1 more" for that was simply false.
    const openPositions = gaps.reduce((sum, g) => sum + g.short, 0)

    // The count lives in the DETAIL, not the title. Hebrew wants the noun to
    // agree with the number, and a role name is a fixed string that cannot be
    // pluralised — "חסרים 4 מלצר/ית" is simply ungrammatical. The title names
    // the role, the detail carries the arithmetic, and both stay correct for
    // any role a venue invents.
    const positions = openPositions === 1
      ? 'תקן אחד לא מאויש'
      : `${openPositions} תקנים לא מאוישים`
    const shiftPhrase = gaps.length > 1
      ? `החל ממשמרת ${first.start}`
      : `משמרת ${first.start}`

    return {
      scheduledToday,
      known: true,
      signal: {
        id: 'schedule-understaffed',
        severity: 'info',
        rank: 30,
        icon: '🗓️',
        title: `${when}: חסר ${roleName}`,
        detail: `${shiftPhrase} — ${positions}`,
        href: '/owner/schedule',
        actionLabel: 'לסידור',
        kind: 'link',
      },
    }
  } catch {
    return miss
  }
}

/** Role ids are venue data (`shift_settings.roles`), so a venue can invent one
 *  this build has never heard of — and a venue can rename a seeded one, which
 *  this will then render under its seeded name.
 *
 *  Read from DEFAULT_ROLES rather than a second hand-written map, so adding a
 *  role in config.ts cannot leave this function behind. An unknown id falls
 *  back to the id itself: visibly raw, rather than confidently wrong. */
export function roleLabel(roleId: string): string {
  return DEFAULT_ROLES.find((r) => r.id === roleId)?.name.he ?? roleId
}

// ── Entry point ───────────────────────────────────────────────────────

/** Everything the dashboard needs, in one call. Never throws, never rejects —
 *  a total outage returns unknown stats and an empty stack, which renders as a
 *  dashboard with dashes and no alerts rather than an error page. */
export async function readDashboardSignals(): Promise<DashboardSignals> {
  let service: Service
  try {
    service = createServiceClient()
  } catch {
    return { stats: EMPTY_STATS, signals: [] }
  }

  const [menu, floor, stuck, session, reminder, demo, schedule, accessibility] = await Promise.all([
    readMenu(service),
    readFloor(service),
    readStuckItems(service),
    readShiftSession(service),
    readShiftReminder(service),
    readDemoMode(service),
    readSchedule(service),
    readAccessibility(service),
  ])

  const signals = [
    ...menu,
    stuck.signal,
    session,
    reminder,
    demo,
    schedule.signal,
    accessibility,
  ].filter((s): s is DashboardSignal => s !== null)

  signals.sort((a, b) => b.rank - a.rank)

  return {
    stats: {
      openTabs: floor.openTabs,
      floorAgorot: floor.floorAgorot,
      floorKnown: floor.known,
      stuckItems: stuck.count,
      stuckKnown: stuck.known,
      scheduledToday: schedule.scheduledToday,
      scheduleKnown: schedule.known,
    },
    signals,
  }
}
