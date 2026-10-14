// Server-only half of the payslip library: who is asking, what they may list, and the access log. The rules (who may
// read what, the file checks, the ZIP plan) are in ./rules.ts and are PURE; this file only reads and writes.
//
// Same posture as lib/zreport/server.ts and lib/staff/join-server.ts: every function swallows its own errors into a
// typed result, and "migration 060 is not applied yet" (`tableMissing`) is a first-class outcome — the owner approves
// each migration separately, so this code ships first and the pages must be calm until then.
//
// THE VIEWER COMES FROM THE SESSION. `currentPayslipViewer()` is the only place a caller's identity is established,
// and nothing downstream takes a person from the request: an employee asking for `?staff=<someone else>` is not a
// question the code can even express.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isOp } from '@/lib/staff/access'
import { isMissingObject } from '@/lib/server/db-errors'
import type { PayslipMime, PayslipViewer } from './rules'

type Service = SupabaseClient

export const PAYSLIP_BUCKET = 'payslips'

const COLS =
  'id, staff_id, period, file_name, file_mime, file_bytes, uploaded_by_name, uploaded_at, note, employee_first_viewed_at, removed_at'

export interface PayslipRow {
  id: string
  staff_id: string
  period: string
  file_name: string
  file_mime: PayslipMime
  file_bytes: number
  uploaded_by_name: string
  uploaded_at: string
  note: string
  employee_first_viewed_at: string | null
  removed_at: string | null
}

export interface PayslipViewerCtx extends PayslipViewer {
  userId: string
  name: string
}

/** How the owner knows a person: the name on their roster card, never a bare id. */
export function staffFullName(r: {
  first_name?: string | null; last_name?: string | null; display_name?: string | null; email?: string | null
}): string {
  return [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
    || r.display_name?.trim()
    || r.email?.split('@')[0]
    || 'עובד/ת'
}

/** The signed-in, ACTIVE staff member — or null. `isOp` is the owner test from lib/staff/access.ts, the same one
 *  middleware and every other owner route use. */
export async function currentPayslipViewer(): Promise<PayslipViewerCtx | null> {
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return null
  const { data: me } = await createServiceClient()
    .from('staff')
    .select('id, role, badge, first_name, last_name, display_name, email, active')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me || me.active === false) return null
  return { staffId: me.id, isOp: isOp(me), userId: user.id, name: staffFullName(me) }
}

/** Is migration 060 applied? A one-row read; false on any failure (the dashboard then shows the tile locked).
 *
 *  NOT a HEAD request, and that is deliberate: a HEAD has no body, so the 404 PostgREST answers for a missing table
 *  arrives EMPTY, and postgrest-js turns an empty-bodied 404 into "204 No Content" — i.e. no error. A HEAD probe would
 *  therefore report "ready" precisely when the table does not exist. (Found 2026-10-14 by driving the dashboard against
 *  a stand-in with the table switched off.) */
export async function payslipsReady(service: Service): Promise<boolean> {
  try {
    const { error } = await service.from('staff_payslips').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}

export interface PayslipList {
  tableMissing: boolean
  failed: boolean
  rows: PayslipRow[]
}

/** Live payslips, newest month first. A non-owner is ALWAYS narrowed to their own staff id — the optional
 *  `staffId` is honoured only for the owner, so an employee's page cannot be steered at someone else's. */
export async function listPayslips(
  service: Service, viewer: PayslipViewer, opts: { staffId?: string | null; limit?: number } = {},
): Promise<PayslipList> {
  try {
    let q = service.from('staff_payslips').select(COLS).is('removed_at', null)
      .order('period', { ascending: false }).order('uploaded_at', { ascending: false })
      .limit(opts.limit ?? 1000)
    if (!viewer.isOp) q = q.eq('staff_id', viewer.staffId)
    else if (opts.staffId) q = q.eq('staff_id', opts.staffId)
    const { data, error } = await q
    if (error) return { tableMissing: isMissingObject(error), failed: !isMissingObject(error), rows: [] }
    return { tableMissing: false, failed: false, rows: (data ?? []) as PayslipRow[] }
  } catch {
    return { tableMissing: false, failed: true, rows: [] }
  }
}

export interface RosterEntry {
  id: string
  name: string
  /** Names this person might carry in a file name (full name, display name) — for the upload screen's suggestions. */
  names: string[]
  badge: string | null
  /** Has signed in with Google (so they can read their own payslips). */
  linked: boolean
}

/** Everyone the owner can file a payslip under: the active roster. Owner-only callers. */
export async function payslipRoster(service: Service): Promise<RosterEntry[]> {
  try {
    const { data } = await service
      .from('staff')
      .select('id, first_name, last_name, display_name, email, badge, auth_user_id, active')
      .eq('active', true)
    return (data ?? []).map((r) => {
      const full = staffFullName(r)
      const names = Array.from(new Set([full, r.display_name?.trim()].filter((x): x is string => !!x)))
      return { id: r.id as string, name: full, names, badge: (r.badge as string | null) ?? null, linked: !!r.auth_user_id }
    }).sort((a, b) => a.name.localeCompare(b.name, 'he'))
  } catch {
    return []
  }
}

/** id → full name, for the owner's list and the ZIP's file names. Includes removed people (history stays named). */
export async function namesFor(service: Service, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(ids))
  if (!unique.length) return out
  try {
    const { data } = await service
      .from('staff').select('id, first_name, last_name, display_name, email').in('id', unique)
    for (const r of data ?? []) out.set(r.id as string, staffFullName(r))
  } catch { /* names are a convenience; callers fall back */ }
  return out
}

export type PayslipEventKind = 'uploaded' | 'viewed' | 'downloaded' | 'zipped' | 'removed'

/** The access log. BEST EFFORT by design: a log write that fails must never stop an employee reading their own
 *  payslip, and the database refuses to change what is already there (migration 060's trigger). */
export async function recordPayslipEvents(
  service: Service, events: { payslip_id: string; actor_staff_id: string | null; kind: PayslipEventKind }[],
): Promise<void> {
  if (!events.length) return
  try {
    const { error } = await service.from('staff_payslip_events').insert(events)
    if (error) console.error('staff_payslip_events insert failed:', error.code, error.message)
  } catch (err) {
    console.error('staff_payslip_events insert threw:', err)
  }
}

/** First time the EMPLOYEE opens it. The `is null` guard makes it idempotent and keeps the first moment. */
export async function markFirstViewed(service: Service, id: string): Promise<void> {
  try {
    await service.from('staff_payslips')
      .update({ employee_first_viewed_at: new Date().toISOString() })
      .eq('id', id).is('employee_first_viewed_at', null)
  } catch { /* cosmetic */ }
}

/** The rows for these ids INCLUDING the storage path (which the list queries deliberately never select). */
export async function loadPayslipFiles(
  service: Service, ids: string[],
): Promise<{ rows: (PayslipRow & { file_path: string })[]; tableMissing: boolean; failed: boolean }> {
  try {
    const { data, error } = await service.from('staff_payslips').select(`${COLS}, file_path`).in('id', ids)
    if (error) return { rows: [], tableMissing: isMissingObject(error), failed: !isMissingObject(error) }
    return { rows: (data ?? []) as (PayslipRow & { file_path: string })[], tableMissing: false, failed: false }
  } catch {
    return { rows: [], tableMissing: false, failed: true }
  }
}
