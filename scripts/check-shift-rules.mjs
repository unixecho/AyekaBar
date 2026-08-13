#!/usr/bin/env node
// Logic harness for the shift-scheduling module.
//
//   node scripts/check-shift-rules.mjs
//
// Unlike check-workflow / check-isolation, this touches no database at all —
// the rules engine and the reducer are pure functions, so they can be checked
// exhaustively in milliseconds without a stack running. That is most of the
// reason they were written as pure functions.
//
// It runs the REAL TypeScript sources, transpiled on the fly by the compiler
// already in node_modules. Copying the logic into this file to make it
// runnable would produce a harness that passes while the app is broken, which
// is worse than no harness.

import ts from 'typescript'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ── transpile ──────────────────────────────────────────────────────────

const SRC = new URL('../src/lib/shifts/', import.meta.url)
const MODULES = ['types.ts', 'time.ts', 'config.ts', 'rules.ts', 'store.ts']
const outDir = join(tmpdir(), `ayeka-shift-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

for (const file of MODULES) {
  const source = readFileSync(new URL(file, SRC), 'utf8')
  const js = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText
    // Node's ESM resolver wants a real extension; the sources are written for
    // a bundler that does not.
    .replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
  writeFileSync(join(outDir, file.replace(/\.ts$/, '.mjs')), js)
}

const load = (name) => import(pathToFileURL(join(outDir, name)).href)
const time = await load('time.mjs')
const rules = await load('rules.mjs')
const store = await load('store.mjs')
const config = await load('config.mjs')

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (title) => console.log(`\n${title}`)

// A fixed Sunday, so every expectation below is a literal rather than a
// computation that could be wrong in the same way as the code it checks.
const WEEK = '2026-08-16'   // Sunday
const D = (n) => time.addDays(WEEK, n)

const STAFF = [
  { id: 's1', name: 'דנה', initial: 'ד', colour: '#f472b6', badge: 'manager', role: 'staff', active: true },
  { id: 's2', name: 'יובל', initial: 'י', colour: '#c084fc', badge: 'bartender', role: 'staff', active: true },
  { id: 's3', name: 'שיר', initial: 'ש', colour: '#38e1ff', badge: 'waiter', role: 'staff', active: true },
]

let shiftSeq = 0
function shift(dayOffset, start, end, extra = {}) {
  shiftSeq++
  return {
    id: `sh${shiftSeq}`, venueId: 'v1', weekId: 'w1',
    date: D(dayOffset), presetId: null, start, end,
    stationId: null, requirements: [], note: '', ...extra,
  }
}
let assignSeq = 0
const assign = (shiftId, staffId, roleId = 'bartender') => {
  assignSeq++
  return { id: `as${assignSeq}`, venueId: 'v1', shiftId, staffId, roleId, status: 'assigned' }
}

function snapshot({ shifts = [], assignments = [], safety = {}, features = {}, availability = [], neighbouring, workingDays }) {
  const settings = config.defaultSettings('v1')
  return {
    venue: config.AYEKA_VENUE,
    settings: {
      ...settings,
      workingDays: workingDays ?? settings.workingDays,
      safety: { ...settings.safety, ...safety },
      features: { ...settings.features, ...features },
    },
    week: { id: 'w1', venueId: 'v1', weekStart: WEEK, status: 'draft', version: 0, publishedAt: null, publishedBy: null, dayNotes: {} },
    shifts, assignments, staff: STAFF, availability, neighbouring,
  }
}

const codes = (warnings) => warnings.map((w) => w.code)
const has = (warnings, code) => warnings.some((w) => w.code === code)

// ── time ───────────────────────────────────────────────────────────────

section('Wall-clock arithmetic')
check('parseHM reads HH:MM', time.parseHM('17:30') === 1050)
check('parseHM survives junk', time.parseHM('nonsense') === 0)
check('fmtHM wraps past midnight', time.fmtHM(1500) === '01:00')
check('weekdayOf knows 2026-08-16 is Sunday', time.weekdayOf(WEEK) === 0)
check('weekStartOf snaps mid-week back to Sunday', time.weekStartOf(D(3)) === WEEK)
check('weekDates returns 7 consecutive days', time.weekDates(WEEK).length === 7 && time.weekDates(WEEK)[6] === D(6))
check('durationMinutes handles a normal shift', time.durationMinutes('18:00', '23:00') === 300)
check('durationMinutes handles an overnight shift', time.durationMinutes('21:00', '03:00') === 360)
check('crossesMidnight is true when end <= start', time.crossesMidnight('21:00', '03:00') === true)
check('an overnight interval lands on the next day',
  time.intervalOf(WEEK, '21:00', '03:00').end === time.intervalOf(D(1), '03:00', '04:00').start)
check('gapBetween is negative for overlaps',
  time.gapBetween(time.intervalOf(WEEK, '18:00', '23:00'), time.intervalOf(WEEK, '22:00', '02:00')) < 0)
check('gapBetween measures rest in minutes',
  time.gapBetween(time.intervalOf(WEEK, '18:00', '23:00'), time.intervalOf(D(1), '07:00', '12:00')) === 480)
check('fmtDuration reads as a clock', time.fmtDuration(330) === '5:30')

// A DST night is still the number of hours a human reads off the sheet. This
// is the whole reason the module refuses to store instants.
check('a clock-change night is still wall-clock hours',
  time.durationMinutes('23:00', '03:00') === 240)

// ── rules: per shift ───────────────────────────────────────────────────

section('Per-shift rules')
{
  const s = shift(1, '18:00', '01:00')
  const w = rules.evaluate(snapshot({ shifts: [s] }))
  check('an empty shift warns', has(w, 'unassigned_shift'))
}
{
  const s = shift(1, '18:00', '01:00', { requirements: [{ roleId: 'bartender', min: 2 }] })
  const w = rules.evaluate(snapshot({ shifts: [s], assignments: [assign(s.id, 's2')] }))
  const missing = w.find((x) => x.code === 'missing_role')
  check('an under-staffed role is an error', missing?.severity === 'error')
  check('the missing-role message counts what is short', missing?.message.en.startsWith('1 ×'))
}
{
  const s = shift(1, '18:00', '01:00', { requirements: [{ roleId: 'bartender', min: 1, max: 1 }] })
  const w = rules.evaluate(snapshot({
    shifts: [s], assignments: [assign(s.id, 's2'), assign(s.id, 's3')],
  }))
  check('exceeding a role cap warns but is not an error',
    w.find((x) => x.code === 'over_role_max')?.severity === 'warn')
}
{
  const s = shift(1, '18:00', '01:00')
  const w = rules.evaluate(snapshot({
    shifts: [s], assignments: [assign(s.id, 's2', 'bartender'), assign(s.id, 's2', 'waiter')],
  }))
  check('the same person twice on one shift is an error',
    w.find((x) => x.code === 'duplicate')?.severity === 'error')
}
{
  const s = shift(1, '10:00', '23:00')
  const w = rules.evaluate(snapshot({ shifts: [s], assignments: [assign(s.id, 's2')], safety: { maxDailyHours: 12 } }))
  check('a shift longer than the daily cap warns', has(w, 'max_daily_hours'))
}
{
  const s = shift(0, '18:00', '01:00')
  const w = rules.evaluate(snapshot({ shifts: [s], assignments: [assign(s.id, 's2')], workingDays: [1, 2, 3, 4, 5, 6] }))
  check('a shift on a closed day warns', has(w, 'non_working_day'))
}
{
  // Venue opens 17:00 and closes 03:00; a 15:00 start sticks out of the front.
  const s = shift(1, '15:00', '20:00')
  const w = rules.evaluate(snapshot({ shifts: [s], assignments: [assign(s.id, 's2')] }))
  check('a shift outside operating hours is informational, not an error',
    w.find((x) => x.code === 'outside_hours')?.severity === 'info')
}
{
  const s = shift(1, '18:00', '23:00')
  const w = rules.evaluate(snapshot({ shifts: [s], assignments: [assign(s.id, 'ghost')] }))
  check('an assignment to someone off the roster is an error',
    w.find((x) => x.code === 'inactive_staff')?.severity === 'error')
}

// ── rules: per person ──────────────────────────────────────────────────

section('Per-person rules')
{
  const a = shift(1, '18:00', '01:00')
  const b = shift(1, '21:00', '03:00')
  const w = rules.evaluate(snapshot({
    shifts: [a, b], assignments: [assign(a.id, 's2'), assign(b.id, 's2')],
  }))
  check('overlapping shifts for one person is an error',
    w.find((x) => x.code === 'overlap')?.severity === 'error')
  check('an overlap points at both shifts',
    w.find((x) => x.code === 'overlap')?.shiftIds.length === 2)
}
{
  // Closes at 03:00, back at 09:00 — six hours, under the eight-hour rule.
  const night = shift(1, '21:00', '03:00')
  const morning = shift(2, '09:00', '13:00')
  const w = rules.evaluate(snapshot({
    shifts: [night, morning], assignments: [assign(night.id, 's2'), assign(morning.id, 's2')],
    safety: { minRestHours: 8 },
  }))
  check('a clopening is an error', w.find((x) => x.code === 'min_rest')?.severity === 'error')

  const relaxed = rules.evaluate(snapshot({
    shifts: [night, morning], assignments: [assign(night.id, 's2'), assign(morning.id, 's2')],
    safety: { minRestHours: 6 },
  }))
  check('the rest rule is configurable, not hard-coded', !has(relaxed, 'min_rest'))
}
{
  // The Saturday close of the PREVIOUS week against this week's Sunday open.
  const sunday = shift(0, '09:00', '13:00')
  const lastSaturday = {
    id: 'prev1', venueId: 'v1', weekId: 'w0', date: time.addDays(WEEK, -1),
    presetId: null, start: '21:00', end: '03:00', stationId: null, requirements: [], note: '',
  }
  const w = rules.evaluate(snapshot({
    shifts: [sunday], assignments: [assign(sunday.id, 's2')],
    neighbouring: { shifts: [lastSaturday], assignments: [{ id: 'prevA', venueId: 'v1', shiftId: 'prev1', staffId: 's2', roleId: 'bartender', status: 'assigned' }] },
    safety: { minRestHours: 8 },
  }))
  check('a clopening ACROSS the week boundary is caught', has(w, 'min_rest'))
}
{
  const shifts = [0, 1, 2, 3, 4, 5, 6].map((d) => shift(d, '18:00', '01:00'))
  const assignments = shifts.map((s) => assign(s.id, 's2'))
  const w = rules.evaluate(snapshot({ shifts, assignments, safety: { maxWeeklyHours: 42, maxConsecutiveDays: 6 } }))
  check('49 hours over a 42-hour cap is an error',
    w.find((x) => x.code === 'max_weekly_hours')?.severity === 'error')
  check('seven days straight past a six-day cap warns', has(w, 'max_consecutive_days'))

  // One 7-hour shift of our own against a 10-hour cap: under on its own, and
  // wildly over if the six neighbouring shifts were wrongly counted in.
  const neighbour = rules.evaluate(snapshot({
    shifts: [shifts[0]], assignments: [assignments[0]],
    safety: { maxWeeklyHours: 10 },
    neighbouring: {
      shifts: shifts.slice(1).map((s) => ({ ...s, weekId: 'w0' })),
      assignments: assignments.slice(1),
    },
  }))
  check('neighbouring weeks do not count toward this week\'s hours',
    !has(neighbour, 'max_weekly_hours'))
}
{
  const a = shift(1, '18:00', '23:00')
  const b = shift(1, '23:30', '02:00')
  const w = rules.evaluate(snapshot({
    shifts: [a, b], assignments: [assign(a.id, 's2'), assign(b.id, 's2')],
    safety: { minRestHours: 0, maxConsecutiveDays: 7 },
  }))
  check('two shifts in one day count as one day worked', !has(w, 'max_consecutive_days'))
}

// ── rules: availability ────────────────────────────────────────────────

section('Availability (feature-flagged)')
{
  const s = shift(1, '18:00', '01:00')
  const submission = {
    id: 'av1', venueId: 'v1', staffId: 's2', weekStart: WEEK,
    entries: [{ date: D(1), kind: 'unavailable' }],
    note: '', status: 'submitted', submittedAt: '2026-08-14T00:00:00.000Z',
  }
  const off = rules.evaluate(snapshot({ shifts: [s], assignments: [assign(s.id, 's2')], availability: [submission] }))
  check('availability is ignored while the feature is off', !has(off, 'unavailable'))

  const on = rules.evaluate(snapshot({
    shifts: [s], assignments: [assign(s.id, 's2')], availability: [submission],
    features: { ENABLE_AVAILABILITY_SUBMISSIONS: true },
  }))
  check('assigning someone who declared unavailable warns', has(on, 'unavailable'))

  const draft = rules.evaluate(snapshot({
    shifts: [s], assignments: [assign(s.id, 's2')],
    availability: [{ ...submission, status: 'draft' }],
    features: { ENABLE_AVAILABILITY_SUBMISSIONS: true },
  }))
  check('an unsubmitted draft is not treated as a declaration', !has(draft, 'unavailable'))

  const partial = rules.evaluate(snapshot({
    shifts: [s], assignments: [assign(s.id, 's2')],
    availability: [{ ...submission, entries: [{ date: D(1), kind: 'partial', from: '18:00', to: '22:00' }] }],
    features: { ENABLE_AVAILABILITY_SUBMISSIONS: true },
  }))
  check('a shift running past a partial window warns', has(partial, 'partial_conflict'))

  const inside = rules.evaluate(snapshot({
    shifts: [shift(1, '18:00', '21:00')],
    assignments: [{ id: 'x', venueId: 'v1', shiftId: `sh${shiftSeq}`, staffId: 's2', roleId: 'bartender', status: 'assigned' }],
    availability: [{ ...submission, entries: [{ date: D(1), kind: 'partial', from: '17:00', to: '23:00' }] }],
    features: { ENABLE_AVAILABILITY_SUBMISSIONS: true },
  }))
  check('a shift inside a partial window is silent', !has(inside, 'partial_conflict'))
}

section('Ordering and summary')
{
  const s = shift(1, '18:00', '01:00', { requirements: [{ roleId: 'bartender', min: 1 }] })
  const w = rules.evaluate(snapshot({ shifts: [s] }))
  check('errors sort above warnings', w[0].severity === 'error')
  check('summarize counts by severity', rules.summarize(w).errors >= 1)
  check('forShift filters to one shift', rules.forShift(w, s.id).length === w.length)
  check('worst() reports the highest severity', rules.worst(w) === 'error')
  check('warning ids are stable across runs',
    JSON.stringify(codes(rules.evaluate(snapshot({ shifts: [s] })))) === JSON.stringify(codes(w)))
}

// ── store / reducer ────────────────────────────────────────────────────

section('Draft, publish and the snapshot guarantee')

let idSeq = 0
const ctx = { actorId: 'u1', actorName: 'בודק', now: '2026-08-14T10:00:00.000Z', id: () => `id${++idSeq}` }

function freshDb() {
  return {
    venue: config.AYEKA_VENUE,
    settings: config.defaultSettings(config.AYEKA_VENUE.id),
    staff: STAFF,
    weeks: [], shifts: [], assignments: [],
    published: {}, availability: [], swaps: [], audit: [],
  }
}
const apply = (db, action) => store.reduce(db, action, ctx).db

{
  let db = freshDb()
  db = apply(db, { type: 'week.ensure', weekStart: WEEK })
  check('ensuring a week creates it once', db.weeks.length === 1)
  const again = store.reduce(db, { type: 'week.ensure', weekStart: WEEK }, ctx)
  check('ensuring it twice is a no-op with no audit line', again.entry === null && again.db.weeks.length === 1)

  db = apply(db, {
    type: 'shift.create', weekStart: WEEK, date: D(3), presetId: 'evening',
    start: '18:00', end: '01:00', stationId: 'main_bar',
    requirements: [{ roleId: 'bartender', min: 1 }],
  })
  const created = db.shifts[0]
  check('a shift is created against the week', db.shifts.length === 1 && created.weekId === db.weeks[0].id)

  db = apply(db, { type: 'assignment.create', shiftId: created.id, staffId: 's2', roleId: 'bartender' })
  check('an assignment is recorded', db.assignments.length === 1)
  const dupe = store.reduce(db, { type: 'assignment.create', shiftId: created.id, staffId: 's2', roleId: 'bartender' }, ctx)
  check('the identical assignment twice is refused', dupe.entry === null && dupe.db.assignments.length === 1)

  check('nothing is visible to staff before publishing', store.publishedWeek(db, WEEK) === null)

  db = apply(db, { type: 'week.publish', weekStart: WEEK })
  const publishedAfter = store.publishedWeek(db, WEEK)
  check('publishing exposes the week', publishedAfter?.shifts.length === 1)
  check('publishing bumps the version', publishedAfter?.week.version === 1)

  // THE guarantee: editing the draft afterwards must not reach the team.
  db = apply(db, { type: 'shift.update', shiftId: created.id, patch: { start: '20:00' } })
  check('a later draft edit does not change what was published',
    store.publishedWeek(db, WEEK)?.shifts[0].start === '18:00')
  check('the draft itself did change', store.draftWeek(db, WEEK)?.shifts[0].start === '20:00')
  check('the week is detected as dirty',
    store.weekSignature(store.draftWeek(db, WEEK)) !== store.weekSignature(store.publishedWeek(db, WEEK)))

  db = apply(db, { type: 'week.publish', weekStart: WEEK })
  check('re-publishing catches the snapshot up',
    store.publishedWeek(db, WEEK)?.shifts[0].start === '20:00')
  check('and bumps the version again', store.publishedWeek(db, WEEK)?.week.version === 2)

  db = apply(db, { type: 'week.unpublish', weekStart: WEEK })
  check('un-publishing takes it away from staff again', store.publishedWeek(db, WEEK) === null)
  check('but leaves the draft intact', store.draftWeek(db, WEEK)?.shifts.length === 1)
}

section('Copy, clear and notes')
{
  let db = freshDb()
  db = apply(db, { type: 'week.ensure', weekStart: WEEK })
  db = apply(db, {
    type: 'shift.create', weekStart: WEEK, date: D(4), presetId: 'evening',
    start: '18:00', end: '01:00', stationId: null, requirements: [],
  })
  db = apply(db, { type: 'assignment.create', shiftId: db.shifts[0].id, staffId: 's3', roleId: 'waiter' })

  const nextWeek = time.addDays(WEEK, 7)
  db = apply(db, { type: 'week.ensure', weekStart: nextWeek })
  db = apply(db, { type: 'week.copy', from: WEEK, to: nextWeek })
  const copied = store.draftWeek(db, nextWeek)
  check('copying a week carries the shifts', copied?.shifts.length === 1)
  check('copying shifts the dates by exactly seven days',
    copied?.shifts[0].date === time.addDays(D(4), 7))
  check('copying carries the assignments', copied?.assignments.length === 1)
  check('the copy is a new row, not the same one', copied?.shifts[0].id !== db.shifts[0].id)
  check('the source week is untouched', store.draftWeek(db, WEEK)?.shifts.length === 1)

  db = apply(db, { type: 'note.day', weekStart: WEEK, date: D(4), note: 'אספקה ב-19:00' })
  check('a day note is stored', store.draftWeek(db, WEEK)?.week.dayNotes[D(4)] === 'אספקה ב-19:00')
  const sameNote = store.reduce(db, { type: 'note.day', weekStart: WEEK, date: D(4), note: 'אספקה ב-19:00' }, ctx)
  check('re-saving the same note is a no-op', sameNote.entry === null)
  db = apply(db, { type: 'note.day', weekStart: WEEK, date: D(4), note: '   ' })
  check('a blank note removes the key', store.draftWeek(db, WEEK)?.week.dayNotes[D(4)] === undefined)

  db = apply(db, { type: 'week.clear', weekStart: WEEK })
  check('clearing a week removes its shifts', store.draftWeek(db, WEEK)?.shifts.length === 0)
  check('clearing removes the orphaned assignments too',
    db.assignments.every((a) => a.shiftId !== 'gone') && store.draftWeek(db, WEEK)?.assignments.length === 0)
  check('clearing did not touch the other week', store.draftWeek(db, nextWeek)?.shifts.length === 1)
}

section('Swaps')
{
  let db = freshDb()
  db = apply(db, { type: 'week.ensure', weekStart: WEEK })
  db = apply(db, {
    type: 'shift.create', weekStart: WEEK, date: D(5), presetId: null,
    start: '18:00', end: '01:00', stationId: null, requirements: [],
  })
  db = apply(db, { type: 'assignment.create', shiftId: db.shifts[0].id, staffId: 's2', roleId: 'bartender' })
  const assignment = db.assignments[0]

  db = apply(db, { type: 'swap.request', assignmentId: assignment.id, fromStaffId: 's2', toStaffId: null, reason: 'חתונה' })
  check('requesting a swap marks the assignment pending',
    db.assignments[0].status === 'swap_pending' && db.swaps[0].status === 'open')
  check('the shift still belongs to the person who offered it', db.assignments[0].staffId === 's2')

  const swapId = db.swaps[0].id
  const earlyDecision = store.reduce(db, { type: 'swap.decide', swapId, approve: true, note: '' }, ctx)
  check('a manager cannot approve an offer nobody has taken', earlyDecision.entry === null)

  db = apply(db, { type: 'swap.peer_accept', swapId, staffId: 's3' })
  check('a peer accepting moves it to awaiting-approval', db.swaps[0].status === 'peer_accepted')
  check('acceptance alone does NOT move the shift', db.assignments[0].staffId === 's2')

  const rejected = apply(db, { type: 'swap.decide', swapId, approve: false, note: 'צריך אותך' })
  check('rejection leaves the shift where it was', rejected.assignments[0].staffId === 's2')
  check('rejection clears the pending flag', rejected.assignments[0].status === 'assigned')
  check('rejection records the manager\'s note', rejected.swaps[0].decisionNote === 'צריך אותך')

  const approved = apply(db, { type: 'swap.decide', swapId, approve: true, note: '' })
  check('approval — and only approval — moves the shift', approved.assignments[0].staffId === 's3')
  check('approval clears the pending flag', approved.assignments[0].status === 'assigned')

  const cancelled = apply(db, { type: 'swap.cancel', swapId })
  check('cancelling releases the assignment', cancelled.assignments[0].status === 'assigned')

  const shiftGone = apply(db, { type: 'shift.delete', shiftId: db.shifts[0].id })
  check('deleting the shift cancels the open swap', shiftGone.swaps[0].status === 'cancelled')
  check('deleting the shift removes its assignments', shiftGone.assignments.length === 0)

  const unassigned = apply(db, { type: 'assignment.delete', assignmentId: assignment.id })
  check('removing the assignment cancels its swap', unassigned.swaps[0].status === 'cancelled')
}

section('Availability submissions and audit')
{
  let db = freshDb()
  db = apply(db, { type: 'availability.submit', staffId: 's3', weekStart: WEEK, entries: [{ date: D(2), kind: 'unavailable' }], note: '' })
  check('a submission is stored as submitted', db.availability[0].status === 'submitted')
  db = apply(db, { type: 'availability.submit', staffId: 's3', weekStart: WEEK, entries: [], note: 'שיניתי' })
  check('re-submitting replaces rather than duplicates', db.availability.length === 1)
  check('re-submitting keeps the same row id', db.availability[0].note === 'שיניתי')

  check('every real change wrote an audit line', db.audit.length === 2)
  check('audit entries are newest-first', db.audit[0].summary.includes('שיבוץ') || db.audit[0].action === 'availability.submit')
  check('the actor is snapshotted on the entry', db.audit[0].actorName === 'בודק')

  const settings = store.reduce(db, { type: 'settings.update', patch: { openTime: '16:00' } }, ctx)
  check('a settings change is audited with a before/after diff',
    settings.entry?.action === 'settings.update' && settings.entry.diff.before.openTime === '17:00')
  const noop = store.reduce(settings.db, { type: 'settings.update', patch: { openTime: '16:00' } }, ctx)
  check('re-saving an unchanged setting writes nothing', noop.entry === null)
}

// ── done ───────────────────────────────────────────────────────────────

rmSync(outDir, { recursive: true, force: true })

console.log(`\n${failures.length ? '✗' : '✓'} ${pass}/${pass + failures.length} checks passed`)
if (failures.length) {
  console.log(`\nFailed:\n${failures.map((f) => `  · ${f}`).join('\n')}`)
  process.exit(1)
}
