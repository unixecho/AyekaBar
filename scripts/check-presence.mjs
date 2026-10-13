#!/usr/bin/env node
// Logic harness for "who is on shift, when" and the Z-report's rules.
//
//   node scripts/check-presence.mjs
//
// Same shape and the same reasoning as check-cart.mjs / check-feedback.mjs:
// the rules are pure functions with no database and no DOM, so they are
// checked exhaustively in milliseconds, against the REAL TypeScript sources
// (copying the logic in here would produce a harness that passes while the app
// is broken).
//
// WHAT IT IS GUARDING
//   • The Z-report's clock gate — "only after 23:00 Israeli time" — at every
//     boundary, in summer (IDT) and winter (IST) time and across the two
//     clock-change nights. This is the rule the owner stated in words.
//   • Who is "set for the shift" (the fallback while the venue has not
//     published a schedule yet, and the strict rule once it has).
//   • The waiter-call recipient rule's schedule half, which has an SQL twin in
//     migration 056 — the numbers it uses are pinned here so a drift on either
//     side fails loudly.
//   • The file checks (magic bytes, size, amounts) behind the upload.
//   • The customer's "call a waiter" input gate, and — the part that matters
//     most — that the SQL in migrations 056/057 still says the same numbers as
//     the TypeScript (the grace period, who is a recipient, the 2-hour and
//     3-minute windows, the file limits). Each is "one rule spelled twice".

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ── transpile ──────────────────────────────────────────────────────────

const outDir = join(tmpdir(), `ayeka-presence-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

function emit(rel) {
  const url = new URL(`../src/lib/${rel}`, import.meta.url)
  const name = rel.split('/').pop()
  const js = ts.transpileModule(readFileSync(url, 'utf8'), {
    fileName: name, // the .ts name picks the parser — see check-feedback.mjs
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
    .replace(/from '(?:\.\.\/shifts\/|\.\/)([^']+)'/g, "from './$1.mjs'")
  writeFileSync(join(outDir, name.replace(/\.ts$/, '.mjs')), js)
}
for (const f of ['shifts/wall.ts', 'shifts/presence.ts', 'shifts/snapshot.ts', 'zreport/rules.ts', 'waiter/calls.ts']) emit(f)

const load = (n) => import(pathToFileURL(join(outDir, n)).href)
const P = await load('presence.mjs')
const Z = await load('rules.mjs')
const C = await load('calls.mjs')
const SN = await load('snapshot.mjs')

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── zonedNow ───────────────────────────────────────────────────────────
section('zonedNow — one clock read, Israel time')
{
  const tz = 'Asia/Jerusalem'
  // Summer (IDT = UTC+3). 2026-10-13 is still summer time.
  let n = P.zonedNow(tz, new Date('2026-10-13T20:00:00Z'))
  check('20:00Z in October is 23:00 IDT, same date', n.date === '2026-10-13' && n.minutes === 23 * 60, JSON.stringify(n))
  n = P.zonedNow(tz, new Date('2026-10-13T21:30:00Z'))
  check('21:30Z is 00:30 the NEXT date', n.date === '2026-10-14' && n.minutes === 30, JSON.stringify(n))
  // Winter (IST = UTC+2).
  n = P.zonedNow(tz, new Date('2026-12-10T21:00:00Z'))
  check('21:00Z in December is 23:00 IST', n.date === '2026-12-10' && n.minutes === 23 * 60, JSON.stringify(n))
  n = P.zonedNow(tz, new Date('2026-12-10T22:00:00Z'))
  check('22:00Z in December is midnight → 00:00 next date, never "24:00"', n.date === '2026-12-11' && n.minutes === 0, JSON.stringify(n))
  // abs is monotonic across midnight
  const a = P.zonedNow(tz, new Date('2026-12-10T21:59:00Z'))
  const b = P.zonedNow(tz, new Date('2026-12-10T22:01:00Z'))
  check('abs minutes advance by exactly 2 across midnight', b.abs - a.abs === 2, `${b.abs - a.abs}`)
  // A bogus zone must not throw
  let threw = false
  try { P.zonedNow('Not/AZone', new Date()) } catch { threw = true }
  check('an invalid timezone degrades instead of throwing', !threw)
}

// ── zWindow ────────────────────────────────────────────────────────────
section('zWindow — the 23:00 Israeli-time gate')
{
  const at = (iso) => Z.zWindow(new Date(iso))
  // IDT: local = UTC+3
  let w = at('2026-10-13T19:59:00Z') // 22:59 local
  check('22:59 local → CLOSED', w.open === false, JSON.stringify(w))
  check('…and it is 1 minute from opening', w.opensInMinutes === 1)
  w = at('2026-10-13T20:00:00Z') // 23:00 local
  check('23:00 local → OPEN', w.open === true)
  check('…filed under that same date', w.businessDate === '2026-10-13')
  w = at('2026-10-13T20:59:00Z') // 23:59
  check('23:59 → OPEN, same business date', w.open && w.businessDate === '2026-10-13')
  w = at('2026-10-13T21:00:00Z') // 00:00 on the 14th
  check('00:00 → still OPEN but filed under the PREVIOUS date', w.open && w.businessDate === '2026-10-13', JSON.stringify(w))
  w = at('2026-10-13T23:30:00Z') // 02:30 on the 14th
  check('02:30 (a manager closing late) → OPEN, filed under the night that began', w.open && w.businessDate === '2026-10-13')
  w = at('2026-10-14T02:59:00Z') // 05:59 local
  check('05:59 → last open minute', w.open && w.businessDate === '2026-10-13')
  w = at('2026-10-14T03:00:00Z') // 06:00 local
  check('06:00 → CLOSED (rollover)', w.open === false)
  w = at('2026-10-14T09:00:00Z') // noon local
  check('midday → CLOSED, and the next window belongs to TODAY', w.open === false && w.businessDate === '2026-10-14')
  check('midday → opens in 11h', w.opensInMinutes === 11 * 60, `${w.opensInMinutes}`)

  // Winter time (IST = UTC+2): 23:00 local is 21:00Z
  w = at('2026-12-10T20:59:00Z') // 22:59 IST
  check('winter: 22:59 IST → CLOSED', w.open === false)
  w = at('2026-12-10T21:00:00Z')
  check('winter: 23:00 IST → OPEN', w.open === true && w.businessDate === '2026-12-10')

  // The clocks-back night (Israel: Sunday 25 Oct 2026, 02:00 → 01:00). The
  // gate reads LOCAL wall-clock, so 23:00 on the 25th is still 23:00.
  w = at('2026-10-25T21:00:00Z') // 23:00 IST (UTC+2) on the 25th
  check('first evening after clocks go back: 23:00 local → OPEN', w.open && w.businessDate === '2026-10-25', JSON.stringify(w))
  w = at('2026-10-25T20:59:00Z')
  check('…and 22:59 local → CLOSED', w.open === false)

  // Strict reading is one constant away.
  check('the owner\'s two numbers are what the harness expects (23:00, 06:00)', Z.Z_OPEN_HOUR === 23 && Z.BUSINESS_DAY_ROLLOVER_HOUR === 6)
}

// ── zEligibility ───────────────────────────────────────────────────────
section('zEligibility — "the shift manager or general manager set for the shift"')
{
  const night = '2026-10-13'
  const shift = (staffIds, date = night) => ({
    date, start: '18:00', end: '01:00',
    assignments: staffIds.map((id) => ({ staffId: id, roleId: 'waiter', staffName: id })),
  })
  const base = { businessDate: night, isOverride: false, titleOk: true }

  check('OP/dev always may, scheduled or not',
    Z.zEligibility({ ...base, isOverride: true, staffId: 'x', shifts: [shift(['y'])] }).allowed)
  check('a waiter (no manager title) may not, even if scheduled',
    !Z.zEligibility({ ...base, titleOk: false, staffId: 'w', shifts: [shift(['w'])] }).allowed)
  const noSched = Z.zEligibility({ ...base, staffId: 'm', shifts: [] })
  check('no schedule published for the night → any manager may (fallback)', noSched.allowed && noSched.reason === 'schedule_not_in_use')
  check('a schedule exists but only for ANOTHER date → still the fallback',
    Z.zEligibility({ ...base, staffId: 'm', shifts: [shift(['m'], '2026-10-12')] }).reason === 'schedule_not_in_use')
  const sched = Z.zEligibility({ ...base, staffId: 'm', shifts: [shift(['m', 'w'])] })
  check('a manager assigned to that night → allowed', sched.allowed && sched.reason === 'scheduled')
  const off = Z.zEligibility({ ...base, staffId: 'm2', shifts: [shift(['m', 'w'])] })
  check('a manager NOT on that night, with a schedule published → refused', !off.allowed && off.reason === 'not_scheduled')

  // titles
  const t = Z.hasZReportTitle
  check('title: general_manager, manager, owner badge, owner role, Dev badge pass',
    t({ badge: 'general_manager' }) && t({ badge: 'manager' }) && t({ badge: 'owner' }) && t({ role: 'owner' }) && t({ badge: 'Dev' }))
  check('title: waiter / bartender / cook / none / null fail',
    !t({ badge: 'waiter' }) && !t({ badge: 'bartender' }) && !t({ badge: 'cook' }) && !t({}) && !t(null))
}

// ── the file ───────────────────────────────────────────────────────────
section('the file — magic bytes, size, amounts')
{
  const u = (...b) => Uint8Array.from(b)
  check('JPEG is recognised', Z.sniffMime(u(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)) === 'image/jpeg')
  check('PNG is recognised', Z.sniffMime(u(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)) === 'image/png')
  check('WebP is recognised', Z.sniffMime(u(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)) === 'image/webp')
  check('PDF is recognised', Z.sniffMime(u(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31)) === 'application/pdf')
  check('an HTML file renamed .jpg is refused', Z.sniffMime(new TextEncoder().encode('<html><script>alert(1)</script>')) === null)
  check('an SVG (script-capable) is refused', Z.sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')) === null)
  check('a truncated header is refused, not crashed on', Z.sniffMime(u(0xff, 0xd8)) === null && Z.sniffMime(u()) === null)

  const ok = (o) => Z.validateZSubmission({ size: 1000, sniffed: 'image/jpeg', ...o })
  check('a normal upload passes', ok({}).ok)
  check('zero bytes → empty', ok({ size: 0 }).error === 'empty')
  check('over 8 MB → too_big', ok({ size: Z.Z_MAX_BYTES + 1 }).error === 'too_big')
  check('exactly 8 MB is fine', ok({ size: Z.Z_MAX_BYTES }).ok)
  check('unrecognised bytes → bad_type', ok({ sniffed: null }).error === 'bad_type')
  check('total "12,345.60" → 1234560 agorot', ok({ totalInput: '12,345.60' }).totalAgorot === 1234560)
  check('total "980" → 98000 agorot', ok({ totalInput: '980' }).totalAgorot === 98000)
  check('total "₪ 1,200" → 120000 agorot', ok({ totalInput: '₪ 1,200' }).totalAgorot === 120000)
  check('total "12,5" (comma decimal) → 1250 agorot', ok({ totalInput: '12,5' }).totalAgorot === 1250)
  check('total left blank → null, still ok', ok({ totalInput: '  ' }).ok && ok({ totalInput: '' }).totalAgorot === null)
  check('total "abc" → bad_total', ok({ totalInput: 'abc' }).error === 'bad_total')
  check('total "-5" → bad_total', ok({ totalInput: '-5' }).error === 'bad_total')
  check('total "1e9" → bad_total', ok({ totalInput: '1e9' }).error === 'bad_total')
  check('total over ₪1,000,000 → bad_total', ok({ totalInput: '1000001' }).error === 'bad_total')
  check('a 501-char note → note_too_long', ok({ note: 'x'.repeat(501) }).error === 'note_too_long')
  check('the note is trimmed', ok({ note: '  ok  ' }).note === 'ok')
  check('storage path is date/id.ext', Z.zStoragePath('2026-10-13', 'abc', 'application/pdf') === '2026-10-13/abc.pdf')
}

// ── presence ───────────────────────────────────────────────────────────
section('presence — my shifts, the call rule, announcements')
{
  const tz = 'Asia/Jerusalem'
  const at = (iso) => P.zonedNow(tz, new Date(iso))
  // 2026-10-13 evening shift 18:00 → 01:00, two people.
  const evening = {
    id: 's1', date: '2026-10-13', start: '18:00', end: '01:00',
    assignments: [{ staffId: 'ann', roleId: 'waiter' }, { staffId: 'ben', roleId: 'shift_leader' }],
  }
  const tomorrow = { id: 's2', date: '2026-10-14', start: '18:00', end: '01:00', assignments: [{ staffId: 'ann', roleId: 'waiter' }] }

  // 17:00 local = 14:00Z
  let st = P.myShiftState([evening, tomorrow], 'ann', at('2026-10-13T14:00:00Z'))
  check('17:00 — not on yet; next is tonight, in 60 minutes', st.current === null && st.next?.id === 's1' && st.startsInMinutes === 60, JSON.stringify(st))
  check('…and the following one is queued behind it', st.upcoming.length === 2 && st.upcoming[1].id === 's2')
  st = P.myShiftState([evening, tomorrow], 'ann', at('2026-10-13T16:00:00Z')) // 19:00
  check('19:00 — on shift, 6h left', st.current?.id === 's1' && st.endsInMinutes === 360, JSON.stringify(st))
  check('…and today\'s remaining planned time is that 6h', st.todayMinutes === 360)
  st = P.myShiftState([evening, tomorrow], 'ann', at('2026-10-13T22:30:00Z')) // 01:30 on the 14th
  check('01:30 — the shift ended at 01:00; next is tomorrow\'s', st.current === null && st.next?.id === 's2')
  st = P.myShiftState([evening], 'zed', at('2026-10-13T16:00:00Z'))
  check('someone not on the shift sees nothing', st.current === null && st.next === null && st.upcoming.length === 0)
  st = P.myShiftState([evening], null, at('2026-10-13T16:00:00Z'))
  check('a null staff id matches nobody (never "everyone")', st.current === null)

  // the call rule
  check('call rule: grace is 30 minutes', P.SHIFT_END_GRACE_MINUTES === 30)
  let r = P.onShiftForCalls([], 'ann', at('2026-10-13T16:00:00Z'))
  check('call rule: no schedule at all → eligible (fallback)', r.eligible && r.reason === 'schedule_not_in_use')
  r = P.onShiftForCalls([evening], 'ann', at('2026-10-13T16:00:00Z'))
  check('call rule: scheduled and inside the shift → eligible', r.eligible && r.reason === 'scheduled')
  r = P.onShiftForCalls([evening], 'zed', at('2026-10-13T16:00:00Z'))
  check('call rule: schedule in use, NOT assigned → not eligible', !r.eligible && r.reason === 'not_scheduled')
  r = P.onShiftForCalls([evening], 'ann', at('2026-10-13T22:20:00Z')) // 01:20 — 20 min after end
  check('call rule: 20 minutes after the end is still covered (grace)', r.eligible)
  r = P.onShiftForCalls([evening], 'ann', at('2026-10-13T22:40:00Z')) // 01:40 — 40 min after
  check('call rule: 40 minutes after the end is NOT covered', !r.eligible)
  r = P.onShiftForCalls([evening], 'ann', at('2026-10-13T13:00:00Z')) // 16:00, before start
  check('call rule: before the shift starts is NOT covered', !r.eligible)
  r = P.onShiftForCalls([tomorrow], 'ann', at('2026-10-13T16:00:00Z'))
  check('call rule: a schedule that only has TOMORROW is "not in use" tonight', r.eligible && r.reason === 'schedule_not_in_use')
  const yday = { id: 's0', date: '2026-10-12', start: '18:00', end: '01:00', assignments: [{ staffId: 'ann' }] }
  r = P.onShiftForCalls([yday], 'ann', at('2026-10-12T22:00:00Z')) // 01:00 on the 13th → the 12th's shift just ended
  check('call rule: a shift dated YESTERDAY counts as "in use" after midnight (and covers its own grace)', r.eligible && r.reason === 'scheduled', JSON.stringify(r))

  // announcements
  let a = P.liveShiftAnnouncements([evening], at('2026-10-13T14:35:00Z')) // 17:35: 25 min before start
  check('17:35 → "starting soon" (the 30-min mark passed 5 minutes ago)', a.length === 1 && a[0].kind === 'starting_soon', JSON.stringify(a))
  a = P.liveShiftAnnouncements([evening], at('2026-10-13T14:00:00Z')) // 17:00 — 60 min before
  check('17:00 → nothing yet', a.length === 0)
  a = P.liveShiftAnnouncements([evening], at('2026-10-13T15:02:00Z')) // 18:02
  check('18:02 → "started"', a.length === 1 && a[0].kind === 'started')
  a = P.liveShiftAnnouncements([evening], at('2026-10-13T15:30:00Z')) // 18:30
  check('18:30 → the "started" news is stale (>10 min): nothing', a.length === 0)
  a = P.liveShiftAnnouncements([evening], at('2026-10-13T21:48:00Z')) // 00:48 — 12 min before end
  check('00:48 → "ending soon"', a.length === 1 && a[0].kind === 'ending_soon', JSON.stringify(a))
  a = P.liveShiftAnnouncements([evening], at('2026-10-13T22:03:00Z')) // 01:03
  check('01:03 → "ended"', a.length === 1 && a[0].kind === 'ended')
  check('the id is stable per (shift, kind) so devices agree', a[0].id === 's1:ended')
  a = P.liveShiftAnnouncements([evening, tomorrow], at('2026-10-13T15:02:00Z'))
  check('two shifts, one live moment → one announcement (no backlog)', a.length === 1)
}

// ── the published snapshot, in BOTH shapes ─────────────────────────────
section('shiftsFromSnapshot — the old nested shape and the rebuilt flat one')
{
  const f = SN.shiftsFromSnapshot
  // OLD (migration 027, until 052 converts it in place)
  const old = { shifts: [{ id: 's1', date: '2026-10-13', start: '18:00', end: '01:00', presetId: null,
    assignments: [{ id: 'a1', staffId: 'ann', staffName: 'Ann', roleId: 'waiter', status: 'assigned' }, { id: 'a2', staffId: 'ben', staffName: 'Ben', roleId: 'shift_leader' }] }] }
  let r = f(old)
  check('OLD shape: one shift, correct date/start/end', r.length === 1 && r[0].date === '2026-10-13' && r[0].start === '18:00' && r[0].end === '01:00')
  check('OLD shape: both nested assignments are read, with staff and role', r[0].assignments.length === 2 && r[0].assignments[0].staffId === 'ann' && r[0].assignments[1].roleId === 'shift_leader')

  // NEW (what sched_publish_week writes since 052): to_jsonb of the real rows
  const flat = {
    shifts: [
      { id: 's1', venue_id: 'v', week_id: 'w', shift_date: '2026-10-13', start_time: '18:00', end_time: '01:00', requests_open: false, note: null },
      { id: 's2', venue_id: 'v', week_id: 'w', shift_date: '2026-10-14', start_time: '18:00:00', end_time: '23:30:00' },
    ],
    assignments: [
      { id: 'a1', shift_id: 's1', staff_id: 'ann', staff_name: 'Ann', role_id: 'waiter', status: 'assigned' },
      { id: 'a2', shift_id: 's1', staff_id: 'ben', staff_name: 'Ben', role_id: 'shift_leader', status: 'assigned' },
      { id: 'a3', shift_id: 's2', staff_id: 'ann', staff_name: 'Ann', role_id: 'waiter', status: 'swap_pending' },
    ],
  }
  r = f(flat)
  check('NEW shape: two shifts', r.length === 2)
  check('NEW shape: shift_date / start_time / end_time are read', r[0].date === '2026-10-13' && r[0].start === '18:00' && r[0].end === '01:00')
  check('NEW shape: a time column rendered "HH:MM:SS" is trimmed to HH:MM', r[1].start === '18:00' && r[1].end === '23:30')
  check('NEW shape: assignments are joined to their shift by shift_id', r[0].assignments.length === 2 && r[1].assignments.length === 1 && r[1].assignments[0].staffId === 'ann')
  check('NEW shape: staff_id / role_id map to staffId / roleId', r[0].assignments[1].staffId === 'ben' && r[0].assignments[1].roleId === 'shift_leader')

  // camelCase on the flat shape (the TS serializer accepts both)
  r = f({ shifts: [{ id: 'x', date: '2026-10-13', startTime: '10:00', endTime: '12:00' }], assignments: [{ shiftId: 'x', staffId: 'cy', roleId: 'host' }] })
  check('camelCase flat shape is read too', r.length === 1 && r[0].start === '10:00' && r[0].assignments[0].staffId === 'cy')

  // junk never throws and never invents anything
  for (const junk of [null, undefined, 5, 'x', [], {}, { shifts: 'no' }, { shifts: [null] }, { shifts: [{}] }, { shifts: [{ date: '2026-10-13' }] }]) {
    let out, threw = false
    try { out = f(junk) } catch { threw = true }
    check(`junk ${JSON.stringify(junk)} → no shifts, no throw`, !threw && Array.isArray(out) && out.length === 0)
  }
  check('a shift with no assignments is kept, with an empty list', f({ shifts: [{ id: 'q', shift_date: '2026-10-13', start_time: '10:00', end_time: '11:00' }], assignments: [] })[0].assignments.length === 0)
  // the rule consumers rely on: a snapshot read feeds straight into the presence rules
  const asShifts = f(flat)
  const st = P.myShiftState(asShifts, 'ann', P.zonedNow('Asia/Jerusalem', new Date('2026-10-13T16:00:00Z')))
  check('end to end: the flat snapshot drives myShiftState (Ann is on at 19:00)', st.current?.id === 's1')
}

// ── the customer's call ────────────────────────────────────────────────
section('validateCallInput — the gate in front of the public endpoint')
{
  const v = C.validateCallInput
  check('a normal call passes', v({ tableNumber: 7, kind: 'waiter' }).ok)
  check('the kind defaults to "waiter"', v({ tableNumber: 7 }).value?.kind === 'waiter')
  check('a numeric string table is accepted ("12")', v({ tableNumber: '12' }).value?.tableNumber === 12)
  check('…with surrounding spaces', v({ tableNumber: ' 5 ' }).value?.tableNumber === 5)
  for (const [name, input] of [
    ['table 0', { tableNumber: 0 }], ['table 1000', { tableNumber: 1000 }], ['table -3', { tableNumber: -3 }],
    ['table 2.5', { tableNumber: 2.5 }], ['table "abc"', { tableNumber: 'abc' }], ['table "1e2"', { tableNumber: '1e2' }],
    ['table null', { tableNumber: null }], ['no table', {}],
  ]) check(`refuses ${name}`, v(input).error === 'bad_table')
  for (const k of ['pizza', 3, null, '', 'WAITER']) check(`refuses kind ${JSON.stringify(k)}`, v({ tableNumber: 1, kind: k }).error === 'bad_kind')
  check('refuses a negative cart count', v({ tableNumber: 1, cartItems: -1 }).error === 'bad_cart')
  check('refuses a cart of 501 lines', v({ tableNumber: 1, cartItems: 501 }).error === 'bad_cart')
  check('refuses a fractional total', v({ tableNumber: 1, cartTotalAgorot: 10.5 }).error === 'bad_cart')
  check('refuses a total over ₪1,000,000', v({ tableNumber: 1, cartTotalAgorot: 100_000_001 }).error === 'bad_cart')
  for (const junk of [null, 'x', 5, []]) check(`refuses a non-object body ${JSON.stringify(junk)}`, v(junk).error === 'bad_request')
  check('extra fields are ignored, never copied through',
    !('isAdmin' in (v({ tableNumber: 1, isAdmin: true }).value ?? {})))
}

section('who is told — the title half of waiter_is_call_recipient()')
{
  const t = C.isCallRecipientTitle
  check('waiter, shift manager, general manager, owner badge, owner role, Dev badge are recipients',
    t({ badge: 'waiter' }) && t({ badge: 'manager' }) && t({ badge: 'general_manager' }) && t({ badge: 'owner' }) &&
    t({ role: 'owner' }) && t({ role: 'staff', badge: 'Dev' }))
  check('a bartender, a cook, a busboy, a host and nobody are NOT',
    !t({ badge: 'bartender' }) && !t({ badge: 'cook' }) && !t({ badge: 'busboy' }) && !t({ badge: 'receptionist' }) && !t({}) && !t(null))
  check('every language has every error message', Object.values(C.CALL_UI.errors).every((m) => m.he && m.en && m.ar))
  check('every language has every kind label', C.CALL_KINDS.every((k) => C.CALL_UI.kinds[k].he && C.CALL_UI.kinds[k].en && C.CALL_UI.kinds[k].ar))
  check('an unknown error code falls back to the generic one, in the right language',
    C.callErrorText('???', 'en') === C.CALL_UI.errors.server.en && C.callErrorText(undefined, 'ar') === C.CALL_UI.errors.server.ar)
}

// ── TypeScript <-> SQL: one rule spelled twice ─────────────────────────
section('TypeScript ↔ SQL — the numbers migrations 056 and 057 must agree on')
{
  const sql = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
  const noComments = (t) => t.replace(/--[^\n]*/g, '')
  const c53 = noComments(sql('057_waiter_calls_and_schedule_sync.sql'))
  const c52 = noComments(sql('056_z_reports.sql'))

  const grace = /end_ts \+ interval '(\d+) minutes'/.exec(c53)
  check(`the end-of-shift grace is ${P.SHIFT_END_GRACE_MINUTES} minutes in SQL too`, Number(grace?.[1]) === P.SHIFT_END_GRACE_MINUTES, String(grace?.[1]))

  const sqlBadges = /badge in \(([^)]*)\)/.exec(c53)?.[1].split(',').map((x) => x.trim().replace(/'/g, '')).sort()
  check('the SQL recipient badges are exactly CALL_RECIPIENT_BADGES',
    JSON.stringify(sqlBadges) === JSON.stringify([...C.CALL_RECIPIENT_BADGES].sort()), JSON.stringify(sqlBadges))
  check('…and the SQL also admits role owner and a Dev badge, like isCallRecipientTitle',
    /role = 'owner'/.test(c53) && /lower\(coalesce\(v_staff\.badge, ''\)\) = 'dev'/.test(c53))

  const open = /called_at > now\(\) - interval '(\d+) hours'/.exec(c53)
  check(`an open call stays listed ${C.CALL_OPEN_WINDOW_MINUTES} minutes in SQL too`, Number(open?.[1]) * 60 === C.CALL_OPEN_WINDOW_MINUTES, String(open?.[1]))
  const dedupe = /called_at > now\(\) - interval '(\d+) minutes'/.exec(c53)
  check(`a repeat tap collapses within ${C.CALL_DEDUPE_MINUTES} minutes in SQL too`, Number(dedupe?.[1]) === C.CALL_DEDUPE_MINUTES, String(dedupe?.[1]))
  check('the SQL table range is 1..999', /p_table_number < 1 or p_table_number > 999/.test(c53) && C.CALL_TABLE_MIN === 1 && C.CALL_TABLE_MAX === 999)
  check('the SQL kind vocabulary equals CALL_KINDS',
    C.CALL_KINDS.every((k) => c53.includes(`'${k}'`)) && /p_kind not in \('waiter', 'bill', 'assistance'\)/.test(c53))
  check('the SQL clamps the cart to 500 lines / ₪1,000,000 like the TS caps',
    /least\(greatest\(coalesce\(p_cart_items, 0\), 0\), 500\)/.test(c53) && /100000000/.test(c53) &&
    C.CALL_CART_ITEMS_MAX === 500 && C.CALL_CART_TOTAL_MAX_AGOROT === 100_000_000)
  check('"schedule in use" looks at yesterday and today only, in SQL as in presence.ts',
    /shift_date in \(v_today - 1, v_today\)/.test(c53))
  check('the customer write is granted to NOBODY (service role only)',
    /revoke execute on function public\.create_table_call\(integer, text, integer, integer\) from public, anon, authenticated;/.test(c53) &&
    !/grant\s+execute on function public\.create_table_call/.test(c53))
  check('no function in 057 is granted to anon', !/grant[^;]*\bto\b[^;]*\banon\b/.test(c53))

  check('056: the file size limit is Z_MAX_BYTES in the CHECK and in the bucket',
    new RegExp(`file_bytes <= ${Z.Z_MAX_BYTES}`).test(c52) && new RegExp(`${Z.Z_MAX_BYTES},\\s*array`).test(c52))
  check('056: the MIME allow-list is Z_ALLOWED_MIME (and SVG is not on it)',
    Z.Z_ALLOWED_MIME.every((mt) => c52.includes(`'${mt}'`)) && !c52.includes('svg'))
  check('056: the note cap is Z_NOTE_MAX and the total cap is Z_TOTAL_MAX_AGOROT',
    new RegExp(`char_length\\(note\\) <= ${Z.Z_NOTE_MAX}`).test(c52) && new RegExp(`total_agorot <= ${Z.Z_TOTAL_MAX_AGOROT}`).test(c52))
  check('056: RLS on, no policy, grants revoked',
    /enable row level security/.test(c52) && !/create policy/.test(c52) && /revoke all on table public\.z_reports from anon, authenticated/.test(c52))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
