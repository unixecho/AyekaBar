// The payslip library's rules — PURE (no React, no Supabase, no Next), so every one of them can be checked to
// exhaustion in milliseconds by scripts/check-payslips.mjs against THIS file, not a copy. Same discipline as
// lib/zreport, lib/cart and lib/shifts.
//
// WHAT IS BEING BUILT (owner, 2026-10-14): "a viewing port for watching payslips without having to download them
// individually, [and] multiple downloads at once as a zip". Payslips (תלושי שכר) are one file per person per month —
// usually the PDF the accountant's payroll software produces, sometimes a photo. The owner uploads them; each
// employee reads only their own; the owner reads everyone's.
//
// THE ONE ACCESS RULE, stated once (`canReadPayslip`): the OWNER (OP) may read any live payslip; anyone else may
// read only a live payslip whose staff_id is THEIR OWN staff row — and "their own" always comes from the session,
// never from a request field. Everything else in this file is bookkeeping around that sentence.

// ── limits ─────────────────────────────────────────────────────────────────

/** ⚠️ ONE RULE SPELLED TWICE with migration 060's `file_bytes` check and the bucket's file_size_limit. */
export const PAYSLIP_MAX_BYTES = 8 * 1024 * 1024
/** ⚠️ ONE RULE SPELLED TWICE with migration 060 (`file_mime` check + bucket allowed_mime_types). */
export const PAYSLIP_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
export type PayslipMime = (typeof PAYSLIP_MIME)[number]
export const PAYSLIP_NOTE_MAX = 300
/** ⚠️ ONE RULE SPELLED TWICE with migration 060's file_name check. */
export const PAYSLIP_NAME_MAX = 200

/** One ZIP download: at most this many files, and at most this many bytes of them. The route refuses beyond. */
export const ZIP_MAX_FILES = 150
export const ZIP_MAX_BYTES = 150 * 1024 * 1024

export const PAYSLIP_EXTENSION: Record<PayslipMime, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s)

// ── who may read what ──────────────────────────────────────────────────────

export interface PayslipViewer {
  /** The caller's own staff row id — from the session, never from the request. */
  staffId: string
  /** OP (owner) — the only role that reads other people's payslips. */
  isOp: boolean
}
export interface PayslipOwnership { staff_id: string; removed_at: string | null }

export function canReadPayslip(viewer: PayslipViewer | null | undefined, row: PayslipOwnership | null | undefined): boolean {
  if (!viewer || !row) return false
  if (row.removed_at) return false           // a removed payslip is gone for everyone
  if (viewer.isOp) return true
  return !!viewer.staffId && row.staff_id === viewer.staffId
}

// ── the file ───────────────────────────────────────────────────────────────

/** Identify a file by its first bytes, never by the name or the MIME the browser claims — both are the uploader's
 *  to choose. (The same table lib/zreport/rules.ts uses.) */
export function sniffPayslip(b: Uint8Array): PayslipMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) return 'image/png'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp'
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf'
  }
  return null
}

/** A name safe to keep in the database and to show: no path parts, no control characters, no bidi overrides
 *  (a right-to-left override can make `evil.exe` read as `exe.live`), trimmed to PAYSLIP_NAME_MAX. */
export function cleanFileName(raw: string | null | undefined): string {
  let s = String(raw ?? '')
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ')
  s = s.replace(/[\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g, '')
  s = s.replace(/[\\/]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^\.+/, '')
  if (s.length > PAYSLIP_NAME_MAX) {
    const dot = s.lastIndexOf('.')
    const ext = dot > 0 && s.length - dot <= 8 ? s.slice(dot) : ''
    s = s.slice(0, PAYSLIP_NAME_MAX - ext.length).trimEnd() + ext
  }
  return s
}

// ── months ─────────────────────────────────────────────────────────────────

export const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
] as const

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/

/** "2026-09" (or "2026-09-01") → "2026-09-01", the way a month is stored. Anything else → null. */
export function parsePeriod(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const m = PERIOD_RE.exec(input.trim())
  if (!m) return null
  const year = Number(m[1])
  if (year < 2000 || year > 2100) return null
  return `${m[1]}-${m[2]}-01`
}

/** "2026-09-01" → "ספטמבר 2026". */
export function periodLabel(period: string): string {
  const p = parsePeriod(period)
  if (!p) return period
  return `${HEBREW_MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`
}

/** "2026-09-01" → "2026-09" — for file names. */
export const periodStamp = (period: string): string => period.slice(0, 7)

/** The month that has just ended, in the venue's own timezone — the month a payslip handed over today is FOR. */
export function previousPeriod(at: Date = new Date(), timeZone = 'Asia/Jerusalem'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(at)
  let year = Number(parts.find((p) => p.type === 'year')?.value)
  let month = Number(parts.find((p) => p.type === 'month')?.value)
  month -= 1
  if (month < 1) { month = 12; year -= 1 }
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/** The last `n` months, newest first, starting from the CURRENT month (a payslip is sometimes issued inside the
 *  month it covers) — what the month picker offers. */
export function recentPeriods(n: number, at: Date = new Date(), timeZone = 'Asia/Jerusalem'): string[] {
  const cur = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(at)
  let y = Number(cur.find((p) => p.type === 'year')?.value)
  let m = Number(cur.find((p) => p.type === 'month')?.value)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`)
    m -= 1
    if (m < 1) { m = 12; y -= 1 }
  }
  return out
}

// ── the upload ─────────────────────────────────────────────────────────────

export type PayslipUploadError =
  | 'no_file' | 'empty' | 'too_big' | 'bad_type' | 'bad_period' | 'bad_staff' | 'note_too_long'

export function validatePayslipUpload(args: {
  size: number
  sniffed: PayslipMime | null
  staffId: unknown
  period: unknown
  note?: unknown
}): { ok: true; period: string; note: string } | { ok: false; error: PayslipUploadError } {
  if (!args.size) return { ok: false, error: 'empty' }
  if (args.size > PAYSLIP_MAX_BYTES) return { ok: false, error: 'too_big' }
  if (!args.sniffed) return { ok: false, error: 'bad_type' }
  if (!isUuid(args.staffId)) return { ok: false, error: 'bad_staff' }
  const period = parsePeriod(args.period)
  if (!period) return { ok: false, error: 'bad_period' }
  const note = typeof args.note === 'string' ? args.note.trim() : ''
  if (note.length > PAYSLIP_NOTE_MAX) return { ok: false, error: 'note_too_long' }
  return { ok: true, period, note }
}

/** `<staff id>/<YYYY-MM>/<uuid>.<ext>` — the employee first, so a bucket listing groups a person's files, and a
 *  random id last so a replacement never overwrites the file it replaces. ⚠️ ONE RULE SPELLED TWICE with the
 *  `file_path` check in migration 060. */
export const payslipStoragePath = (staffId: string, period: string, id: string, mime: PayslipMime): string =>
  `${staffId}/${periodStamp(period)}/${id}.${PAYSLIP_EXTENSION[mime]}`

// ── "which employee, which month?" — read off a file name ──────────────────
//
// The accountant sends twenty PDFs named things like "תלוש שכר - דנה כהן - 09-2026.pdf". Typing twenty
// employees and twenty months invites exactly the mistake that matters here (a payslip under the wrong
// person), so the upload screen PRE-FILLS what the file name says and the owner confirms each row. It is a
// suggestion, never a decision: nothing is sent until the owner has looked at every row, and an ambiguous name
// yields no suggestion at all rather than a guess.

export interface RosterName {
  id: string
  /** Every spelling this person might appear under in a file name: "First Last", the display name, … */
  names: string[]
}

const SEPARATORS = /[\s_\-.,;:()[\]{}'"`׳״|/\\+]+/g

function wordsOf(s: string): string[] {
  return s.toLowerCase().replace(SEPARATORS, ' ').trim().split(' ').filter(Boolean)
}

const MONTH_WORDS: Record<string, number> = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
  'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** The month a file name says it is for, or null — including when it names TWO different months. */
export function periodFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '')
  const found = new Set<string>()
  const add = (y: number, m: number) => {
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) found.add(`${y}-${String(m).padStart(2, '0')}-01`)
  }
  let m: RegExpExecArray | null
  // 2026-09 · 2026_09 · 2026.09 · 202609
  const ym = /(^|\D)(20\d{2})[-_. /]?(0[1-9]|1[0-2])(?!\d)/g
  while ((m = ym.exec(base))) add(Number(m[2]), Number(m[3]))
  // 09-2026 · 9.2026 · 09/2026 · 092026
  const my = /(^|\D)(0?[1-9]|1[0-2])[-_. /]?(20\d{2})(?!\d)/g
  while ((m = my.exec(base))) add(Number(m[3]), Number(m[2]))
  // "ספטמבר 2026" / "September 2026" / "2026 ספטמבר"
  const words = wordsOf(base)
  const years = words.filter((w) => /^20\d{2}$/.test(w)).map(Number)
  const months = words.map((w) => MONTH_WORDS[w]).filter((x): x is number => !!x)
  if (years.length === 1 && months.length === 1) add(years[0], months[0])
  return found.size === 1 ? Array.from(found)[0] : null
}

/** Which person a file name names — only when exactly one person fits best. Every word of one of their names must
 *  appear as a whole word in the file name; a single-word name (a first name alone) counts only if no one else on
 *  the roster shares that word. */
export function staffFromFileName(fileName: string, roster: RosterName[]): string | null {
  const fileWords = new Set(wordsOf(fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '')))
  // How many people use each word, for the "first name alone" rule.
  const users = new Map<string, Set<string>>()
  for (const r of roster) for (const n of r.names) for (const w of wordsOf(n)) {
    if (!users.has(w)) users.set(w, new Set())
    users.get(w)!.add(r.id)
  }
  let best = 0
  let winners: string[] = []
  for (const r of roster) {
    let score = 0
    for (const n of r.names) {
      const w = wordsOf(n)
      if (!w.length || !w.every((x) => fileWords.has(x))) continue
      if (w.length === 1 && (users.get(w[0])?.size ?? 0) > 1) continue
      score = Math.max(score, w.length)
    }
    if (!score) continue
    if (score > best) { best = score; winners = [r.id] }
    else if (score === best) winners.push(r.id)
  }
  return winners.length === 1 ? winners[0] : null
}

export interface FileSuggestion { staffId: string | null; period: string | null }
export const suggestForFile = (fileName: string, roster: RosterName[]): FileSuggestion => ({
  staffId: staffFromFileName(fileName, roster),
  period: periodFromFileName(fileName),
})

// ── ZIP: which files, under what names ─────────────────────────────────────

export interface ZipSource {
  id: string
  staff_id: string
  period: string
  file_mime: PayslipMime
  file_bytes: number
  /** The employee's name as the owner knows it. */
  staffName: string
}

/** A file or folder name that is safe on Windows, macOS and Linux and in a ZIP: no separators, no reserved
 *  characters, no trailing dots/spaces, no `..`. Empty becomes the fallback. */
export function zipSegment(raw: string, fallback = 'ללא שם'): string {
  let s = cleanFileName(raw)
  s = s.replace(/[<>:"|?*]/g, ' ').replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/g, '')
  if (!s || /^\.+$/.test(s)) s = fallback
  if (s.length > 80) s = s.slice(0, 80).trimEnd()
  return s
}

export type ZipPlan =
  | { ok: true; entries: { id: string; path: string }[]; folders: boolean; bytes: number }
  | { ok: false; error: 'empty' | 'too_many' | 'too_big' }

/** The archive's contents, in a stable order (employee by name, then month), with unique names. When the
 *  selection spans more than one person each gets a folder; for one person the files sit at the top level. */
export function planZip(rows: ZipSource[]): ZipPlan {
  if (!rows.length) return { ok: false, error: 'empty' }
  if (rows.length > ZIP_MAX_FILES) return { ok: false, error: 'too_many' }
  const bytes = rows.reduce((n, r) => n + r.file_bytes, 0)
  if (bytes > ZIP_MAX_BYTES) return { ok: false, error: 'too_big' }

  const sorted = [...rows].sort((a, b) =>
    a.staffName.localeCompare(b.staffName, 'he') || a.period.localeCompare(b.period) || a.id.localeCompare(b.id))
  const folders = new Set(sorted.map((r) => r.staff_id)).size > 1
  const taken = new Set<string>()
  const entries = sorted.map((r) => {
    const dir = folders ? `${zipSegment(r.staffName)}/` : ''
    const stem = periodStamp(r.period)
    const ext = PAYSLIP_EXTENSION[r.file_mime]
    let name = `${dir}${stem}.${ext}`
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${dir}${stem} (${n}).${ext}`
    taken.add(name.toLowerCase())
    return { id: r.id, path: name }
  })
  return { ok: true, entries, folders, bytes }
}

/** The ZIP's own file name: "תלושים — דנה כהן — 2026-01 עד 2026-06.zip" style, with an ASCII fallback. */
export function zipDownloadName(rows: ZipSource[]): { utf8: string; ascii: string } {
  const people = Array.from(new Set(rows.map((r) => r.staffName)))
  const periods = rows.map((r) => periodStamp(r.period)).sort()
  const span = periods.length === 0 ? '' : periods[0] === periods[periods.length - 1] ? periods[0] : `${periods[0]}_${periods[periods.length - 1]}`
  const who = people.length === 1 ? zipSegment(people[0]) : `${people.length} עובדים`
  return {
    utf8: `תלושי שכר - ${who}${span ? ` - ${span}` : ''}.zip`,
    ascii: `payslips${span ? `-${span}` : ''}.zip`,
  }
}

/** An RFC 6266 header carrying a Hebrew name safely: a plain ASCII `filename` for old clients and the real one in
 *  `filename*`. Quotes, backslashes and control characters can never reach the header. */
export function contentDisposition(kind: 'inline' | 'attachment', name: { utf8: string; ascii: string }): string {
  const ascii = name.ascii.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const star = encodeURIComponent(name.utf8).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${star}`
}

/** `?ids=a,b,c` → a de-duplicated list of valid UUIDs, or null if anything in it is not one. */
export function parseIdList(raw: string | null | undefined, max = ZIP_MAX_FILES): string[] | null {
  if (!raw) return null
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length || parts.length > max * 2) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const p of parts) {
    if (!isUuid(p)) return null
    const k = p.toLowerCase()
    if (!seen.has(k)) { seen.add(k); out.push(k) }
  }
  return out
}

// ── the library, grouped ───────────────────────────────────────────────────

/** Newest year first; inside a year, newest month first. */
export function groupByYear<T extends { period: string }>(rows: T[]): { year: string; rows: T[] }[] {
  const byYear = new Map<string, T[]>()
  for (const r of rows) {
    const y = r.period.slice(0, 4)
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y)!.push(r)
  }
  return Array.from(byYear.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, list]) => ({ year, rows: list.sort((a, b) => b.period.localeCompare(a.period)) }))
}

export const fmtBytes = (b: number): string =>
  b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`
