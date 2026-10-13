// Server-only half of the Z report: the tables and the bucket. The rules
// (clock window, who may file, file checks) are in ./rules.ts and are PURE; this
// file only reads and writes.
//
// Every function here swallows its own errors into a typed result — the same
// posture as lib/owner/signals.ts. In particular `tableMissing` is a first-class
// outcome, because migration 056 may not have been applied yet: the pages show a
// calm "not set up yet" state instead of a 500.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isDev, isOp } from '@/lib/staff/access'
import { AYEKA_VENUE } from '@/lib/shifts/config'
import { readPublishedShifts } from '@/lib/shifts/published'
import { addDays } from '@/lib/shifts/wall'
import type { PresenceShift } from '@/lib/shifts/presence'
import type { ISODate } from '@/lib/shifts/wall'
import {
  BUSINESS_DAY_ROLLOVER_HOUR, hasZReportTitle, zEligibility, zWindow, type ZEligibility, type ZWindow,
} from './rules'

type Service = SupabaseClient

export const Z_BUCKET = 'z-reports'
const COLS = 'id, business_date, uploaded_by, uploaded_by_name, uploaded_at, file_mime, file_bytes, total_agorot, note'

export interface ZReportRow {
  id: string
  business_date: ISODate
  uploaded_by: string | null
  uploaded_by_name: string
  uploaded_at: string
  file_mime: string
  file_bytes: number
  total_agorot: number | null
  note: string
}

/** PostgREST says 42P01 / PGRST205 when the table is not there. */
export const isMissingTable = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /relation .* does not exist|schema cache/i.test(e.message ?? ''))

// ── Who is asking ─────────────────────────────────────────────────────────

export interface ZViewer {
  staffId: string
  name: string
  role: string
  badge: string | null
  userId: string
}

/** The signed-in staff member (session cookie), or null. Reads their own row
 *  with the service role so a name is always available. */
export async function currentStaff(): Promise<ZViewer | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await createServiceClient()
    .from('staff')
    .select('id, role, badge, first_name, last_name, display_name, email, active')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me || me.active === false) return null
  const name = (me.display_name?.trim()
    || [me.first_name, me.last_name].filter(Boolean).join(' ').trim()
    || me.email?.split('@')[0] || 'צוות')
  return { staffId: me.id, name, role: me.role, badge: me.badge, userId: user.id }
}

// ── The gate, as ONE function both the page and the API call ──────────────

export interface ZAccess {
  window: ZWindow
  eligibility: ZEligibility
  /** Open window AND allowed — the only state in which the form is shown. */
  canFile: boolean
}

/** The page decides what to SHOW with this; the API decides what to ACCEPT
 *  with this. Same function, so they cannot disagree. */
export async function zAccessFor(service: Service, viewer: Pick<ZViewer, 'staffId' | 'role' | 'badge'>, at: Date = new Date()): Promise<ZAccess> {
  const win = zWindow(at)
  const read = await readPublishedShifts(service, addDays(win.businessDate, -1), addDays(win.businessDate, 1))
  // A failed schedule read must not lock a manager out of filing a till slip:
  // treat "unknown" as "no schedule", which is the permissive fallback. The
  // title test still applies.
  const shifts: PresenceShift[] = read.known ? read.shifts : []
  const eligibility = zEligibility({
    titleOk: hasZReportTitle(viewer),
    isOverride: isOp(viewer) || isDev(viewer),
    staffId: viewer.staffId,
    shifts,
    businessDate: win.businessDate,
  })
  return { window: win, eligibility, canFile: win.open && eligibility.allowed }
}

// ── Reads ─────────────────────────────────────────────────────────────────

export interface ZStatus {
  tableMissing: boolean
  /** The newest report for the date, if any. */
  current: ZReportRow | null
  /** How many reports exist for that date (current + superseded). */
  count: number
}

export async function zStatusFor(service: Service, businessDate: ISODate): Promise<ZStatus> {
  try {
    const { data, error } = await service
      .from('z_reports').select(COLS).eq('business_date', businessDate)
      .order('uploaded_at', { ascending: false })
    if (error) return { tableMissing: isMissingTable(error), current: null, count: 0 }
    return { tableMissing: false, current: (data?.[0] as ZReportRow | undefined) ?? null, count: data?.length ?? 0 }
  } catch {
    return { tableMissing: false, current: null, count: 0 }
  }
}

export interface ZArchive {
  tableMissing: boolean
  failed: boolean
  /** Newest first, ALL rows — the page groups by date. */
  rows: ZReportRow[]
}

export async function zArchive(service: Service, limit = 200): Promise<ZArchive> {
  try {
    const { data, error } = await service
      .from('z_reports').select(COLS)
      .order('business_date', { ascending: false }).order('uploaded_at', { ascending: false })
      .limit(limit)
    if (error) return { tableMissing: isMissingTable(error), failed: !isMissingTable(error), rows: [] }
    return { tableMissing: false, failed: false, rows: (data ?? []) as ZReportRow[] }
  } catch {
    return { tableMissing: false, failed: true, rows: [] }
  }
}

/** Business dates in the last `days` on which the bar actually traded (a manual
 *  POS shift session began in that date's 06:00→06:00 day) — the proxy for "a
 *  Z report was expected". Used by the archive to flag nights with none. */
export async function tradedDates(service: Service, days = 30): Promise<ISODate[]> {
  try {
    const since = new Date(Date.now() - (days + 1) * 86_400_000).toISOString()
    const { data } = await service
      .from('waiter_shift_sessions').select('started_at').gte('started_at', since)
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: AYEKA_VENUE.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const out = new Set<ISODate>()
    for (const s of data ?? []) {
      const started = new Date(s.started_at)
      // A session that starts before the rollover hour belongs to the PREVIOUS day.
      const shifted = new Date(started.getTime() - BUSINESS_DAY_ROLLOVER_HOUR * 3_600_000)
      out.add(fmt.format(shifted))
    }
    return Array.from(out)
  } catch {
    return []
  }
}

// ── The owner dashboard's card ────────────────────────────────────────────

export interface ZOverview {
  /** The business date the card describes: tonight's while the window is
   *  open, otherwise the night that just ended. */
  date: ISODate
  windowOpen: boolean
  opensInMinutes: number | null
  status: ZStatus
  /** Did the bar actually trade that night (a POS shift session began)? */
  traded: boolean
}

export async function readZOverview(service: Service, at: Date = new Date()): Promise<ZOverview> {
  const win = zWindow(at)
  const date = win.open ? win.businessDate : addDays(win.businessDate, -1)
  const [status, traded] = await Promise.all([zStatusFor(service, date), tradedDates(service, 3)])
  return {
    date, windowOpen: win.open, opensInMinutes: win.opensInMinutes,
    status, traded: traded.includes(date),
  }
}
