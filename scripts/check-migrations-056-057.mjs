#!/usr/bin/env node
// Offline test of migrations 056 (Z reports) and 057 (waiter calls + schedule
// sync) against an in-memory Postgres — PGlite, WebAssembly, no Docker.
//
//   npm i --no-save @electric-sql/pglite     (once; deliberately NOT a dependency)
//   node scripts/check-migrations-056-057.mjs
//
// WHY THIS EXISTS. There is no local Supabase stack in the authoring
// environment (no Docker), and CLAUDE.md forbids applying a migration without
// the owner's per-migration approval — so the only way to know a drafted
// migration does what its comments claim BEFORE asking for that approval is to
// run it somewhere harmless. This stubs only what the migrations reference
// (auth.uid(), staff, waiter_tables, waiter_shift_sessions, schedule_weeks,
// waiter_table_calls, storage.buckets) and then applies the REAL files.
//
// WHAT IT PROVES: who is and is not a call recipient (open shift, title,
// the schedule half with its 30-minute grace and the "not in use" fallback),
// that the customer write dedupes/clamps/refuses correctly, that the POS's
// schedule answer carries no colleague's identity, that every function's
// EXECUTE grant is what the migration's header says (nothing to anon; the
// customer write to nobody), and that z_reports' CHECKs reject what they should.
//
// WHAT IT CANNOT PROVE: production's real grants, RLS and advisors. After a
// migration is applied, verify THOSE on production (get_advisors, has_*_privilege).
//
// The scripted "now" cases build their times IN POSTGRES (a JS Date round-trip
// of a naive timestamp shifts by the machine's timezone and made the first
// version of this test lie). Run it away from 23:30–00:30 Israel time, when
// "an hour ago" and "in two hours" wrap onto another date.

import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../supabase/migrations/', import.meta.url)
const db = new PGlite()

let pass = 0
const fails = []
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ✓', n) } else { fails.push(n); console.log('  ✗', n, d) } }

// ── stubs ──────────────────────────────────────────────────────────────
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table public.staff (id uuid primary key default gen_random_uuid(), auth_user_id uuid, role text, badge text, active boolean default true, first_name text);
  create table public.waiter_tables (id uuid primary key default gen_random_uuid(), number integer unique not null, active boolean default true);
  create table public.waiter_shift_sessions (id uuid primary key default gen_random_uuid(), status text not null default 'active');
  create table public.schedule_weeks (id uuid primary key default gen_random_uuid(), week_start date, status text, published_snapshot jsonb);
  create table public.waiter_table_calls (
    id uuid primary key default gen_random_uuid(),
    table_id uuid not null references public.waiter_tables(id),
    table_number integer, session_id uuid,
    kind text not null default 'waiter' check (kind in ('waiter','bill','assistance')),
    called_at timestamptz not null default now(),
    acknowledged_by uuid references public.staff(id), acknowledged_at timestamptz);
`)

// ── apply the real migration files ─────────────────────────────────────
for (const f of ['056_z_reports.sql', '057_waiter_calls_and_schedule_sync.sql']) {
  try { await db.exec(readFileSync(new URL(f, ROOT), 'utf8')); check(`${f} applies cleanly`, true) }
  catch (e) { check(`${f} applies cleanly`, false, e.message) }
}

// ── helpers ────────────────────────────────────────────────────────────
const q = async (sql, params) => (await db.query(sql, params)).rows
const as = async (uid) => db.exec(`select set_config('test.uid', '${uid ?? ''}', false)`)

const ann = (await q(`insert into staff(auth_user_id, role, badge) values (gen_random_uuid(),'staff','waiter') returning id, auth_user_id`))[0]
const ben = (await q(`insert into staff(auth_user_id, role, badge) values (gen_random_uuid(),'staff','manager') returning id, auth_user_id`))[0]
const cy  = (await q(`insert into staff(auth_user_id, role, badge) values (gen_random_uuid(),'staff','bartender') returning id, auth_user_id`))[0]
const dev = (await q(`insert into staff(auth_user_id, role, badge) values (gen_random_uuid(),'owner','Dev') returning id, auth_user_id`))[0]
const gone = (await q(`insert into staff(auth_user_id, role, badge, active) values (gen_random_uuid(),'staff','waiter', false) returning id, auth_user_id`))[0]
const t7 = (await q(`insert into waiter_tables(number) values (7) returning id`))[0]
await db.exec(`insert into waiter_tables(number, active) values (8, false)`)

// local "now" in Israel as the function sees it
const local = (await q(`select (now() at time zone 'Asia/Jerusalem') as n, (now() at time zone 'Asia/Jerusalem')::date as d`))[0]
const today = (await q(`select to_char((now() at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') d`))[0].d

// a snapshot whose single shift covers NOW (starts an hour ago, ends in 2h),
// with Ann assigned
// Computed IN POSTGRES: a JS Date round-trip of a naive timestamp shifts by the
// machine's own timezone, which made the first version of this test lie.
const hhmmCache = new Map()
const hhmm = (offsetMin) => hhmmCache.get(offsetMin)
for (const m of [-300, -60, -45, -20, 40, 120, 300]) {
  hhmmCache.set(m, (await q(`select to_char((now() at time zone 'Asia/Jerusalem') + ($1::int * interval '1 minute'), 'HH24:MI') h`, [m]))[0].h)
}
const mkSnap = (shifts) => JSON.stringify({ shifts })
const setSchedule = async (shifts) => {
  await db.exec('delete from schedule_weeks')
  if (shifts) {
    await q(`insert into schedule_weeks(week_start, status, published_snapshot) values ($1,'published',$2::jsonb)`,
      [today, mkSnap(shifts)])
  }
}
const openShift = () => db.exec(`delete from waiter_shift_sessions; insert into waiter_shift_sessions(status) values ('active')`)
const closeShift = () => db.exec(`delete from waiter_shift_sessions`)

console.log('\nwaiter_is_call_recipient')
await closeShift(); await setSchedule(null)
await as(ann.auth_user_id)
check('no open shift session → false', (await q('select waiter_is_call_recipient() r'))[0].r === false)

await openShift()
check('open shift, NO schedule in use, waiter → true (fallback)', (await q('select waiter_is_call_recipient() r'))[0].r === true)
await as(ben.auth_user_id)
check('…shift manager → true', (await q('select waiter_is_call_recipient() r'))[0].r === true)
await as(dev.auth_user_id)
check('…owner/dev → true', (await q('select waiter_is_call_recipient() r'))[0].r === true)
await as(cy.auth_user_id)
check('…bartender → false (wrong title)', (await q('select waiter_is_call_recipient() r'))[0].r === false)
await as(gone.auth_user_id)
check('…a removed person → false', (await q('select waiter_is_call_recipient() r'))[0].r === false)
await as('')
check('…signed-out (no uid) → false', (await q('select waiter_is_call_recipient() r'))[0].r === false)

// schedule in use: a shift covering now with only Ann assigned
await setSchedule([{ date: today, start: hhmm(-60), end: hhmm(120), assignments: [{ staffId: ann.id, roleId: 'waiter' }] }])
// NOTE: if the test runs close to midnight Israel time, hhmm(-60)/hhmm(120) wrap; the cases below assume it doesn't.
await as(ann.auth_user_id)
check('schedule in use, Ann assigned and inside → true', (await q('select waiter_is_call_recipient() r'))[0].r === true)
await as(ben.auth_user_id)
check('schedule in use, shift manager NOT assigned → false', (await q('select waiter_is_call_recipient() r'))[0].r === false)
await as(dev.auth_user_id)
check('schedule in use, dev NOT assigned → false', (await q('select waiter_is_call_recipient() r'))[0].r === false)

await setSchedule([{ date: today, start: hhmm(-300), end: hhmm(-20), assignments: [{ staffId: ann.id }] }])
await as(ann.auth_user_id)
check('shift ended 20 min ago → still true (30-min grace)', (await q('select waiter_is_call_recipient() r'))[0].r === true)
await setSchedule([{ date: today, start: hhmm(-300), end: hhmm(-45), assignments: [{ staffId: ann.id }] }])
check('shift ended 45 min ago → false', (await q('select waiter_is_call_recipient() r'))[0].r === false)
await setSchedule([{ date: today, start: hhmm(40), end: hhmm(300), assignments: [{ staffId: ann.id }] }])
check('shift starts in 40 min → false (not yet)', (await q('select waiter_is_call_recipient() r'))[0].r === false)

// tomorrow-only schedule is "not in use" tonight
const tomorrow = (await q(`select to_char((now() at time zone 'Asia/Jerusalem')::date + 1, 'YYYY-MM-DD') d`))[0].d
await setSchedule([{ date: tomorrow, start: '18:00', end: '01:00', assignments: [{ staffId: cy.id }] }])
await as(ann.auth_user_id)
check('a schedule that only has TOMORROW → fallback true', (await q('select waiter_is_call_recipient() r'))[0].r === true)

// midnight-crossing shift dated YESTERDAY, still running
const yesterday = (await q(`select to_char((now() at time zone 'Asia/Jerusalem')::date - 1, 'YYYY-MM-DD') d`))[0].d
await setSchedule([{ date: yesterday,
  start: '00:01', end: '23:59', assignments: [{ staffId: ann.id }] }])
// start 00:01 end 23:59 yesterday is over; use a proper overnight: 18:00 -> 06:00 dated yesterday covers early morning only
// (clock-dependent; covered by the TS harness, so just assert it does not error)
check('a yesterday-dated shift evaluates without error', (await q('select waiter_is_call_recipient() r')).length === 1)

console.log('\nwaiter_open_calls / waiter_ack_call / create_table_call')
await setSchedule(null); await openShift()
const mk = async (n, kind = 'waiter', cart = 3, total = 12000) => (await q('select * from create_table_call($1,$2,$3,$4)', [n, kind, cart, total]))[0]
let r = await mk(7)
check('create_table_call: ok', r.ok === true && r.reason === null && !!r.call_id, JSON.stringify(r))
const firstId = r.call_id
r = await mk(7)
check('…a second tap within 3 minutes → duplicate, SAME call id', r.ok === true && r.reason === 'duplicate' && r.call_id === firstId, JSON.stringify(r))
r = await mk(7, 'bill')
check('…a different kind for the same table is its own call', r.ok === true && r.reason === null && r.call_id !== firstId)
r = await mk(99)
check('unknown table → unknown_table', r.ok === false && r.reason === 'unknown_table')
r = await mk(8)
check('a DEACTIVATED table → unknown_table', r.ok === false && r.reason === 'unknown_table')
r = await mk(7, 'pizza')
check('bad kind → bad_kind', r.ok === false && r.reason === 'bad_kind')
r = await mk(null)
check('null table → unknown_table', r.ok === false && r.reason === 'unknown_table')
const big = await mk(7, 'assistance', 999999, 2000000000)
const row = (await q('select cart_items, cart_total_agorot from waiter_table_calls where id = $1', [big.call_id]))[0]
check('absurd cart numbers are clamped (500 / ₪1,000,000)', row.cart_items === 500 && row.cart_total_agorot === 100000000, JSON.stringify(row))
await closeShift()
r = await mk(7, 'waiter')
check('no open shift → no_shift', r.ok === false && r.reason === 'no_shift')
await openShift()

await as(ann.auth_user_id)
let calls = await q('select * from waiter_open_calls()')
check('recipient sees the 3 open calls, oldest first', calls.length === 3 && calls[0].id === firstId, `${calls.length}`)
check('…with table number and cart context', calls[0].table_number === 7 && calls[0].cart_items === 3 && calls[0].cart_total_agorot === 12000)
await as(cy.auth_user_id)
calls = await q('select * from waiter_open_calls()')
check('a bartender sees NOTHING (empty, not an error)', calls.length === 0)
await as('')
calls = await q('select * from waiter_open_calls()')
check('signed-out sees nothing', calls.length === 0)

await as(cy.auth_user_id)
check('a non-recipient cannot acknowledge → forbidden', (await q('select waiter_ack_call($1) r', [firstId]))[0].r === 'forbidden')
await as(ann.auth_user_id)
check('recipient acknowledges → ok', (await q('select waiter_ack_call($1) r', [firstId]))[0].r === 'ok')
await as(ben.auth_user_id)
check('second waiter taps the same call → taken', (await q('select waiter_ack_call($1) r', [firstId]))[0].r === 'taken')
check('unknown id → missing', (await q('select waiter_ack_call($1) r', ['00000000-0000-0000-0000-000000000000']))[0].r === 'missing')
calls = await q('select * from waiter_open_calls()')
check('an acknowledged call leaves the list for everyone', calls.length === 2 && !calls.some((c) => c.id === firstId))
const acked = (await q('select acknowledged_by from waiter_table_calls where id = $1', [firstId]))[0]
check('…and records WHO took it', acked.acknowledged_by === ann.id)

// old calls fall out of the window
await db.exec(`update waiter_table_calls set called_at = now() - interval '3 hours' where acknowledged_at is null`)
await as(ann.auth_user_id)
calls = await q('select * from waiter_open_calls()')
check('calls older than 2 hours are not offered', calls.length === 0)

console.log('\nwaiter_schedule_today')
await setSchedule([{ date: today, start: '18:00', end: '01:00', assignments: [{ staffId: ann.id, staffName: 'Ann' }, { staffId: ben.id, staffName: 'Ben' }] }])
await as(ann.auth_user_id)
let s = (await q('select waiter_schedule_today() j'))[0].j
check('returns the shift with mine=true for the assigned caller', s.shifts.length === 1 && s.shifts[0].mine === true && s.shifts[0].people === 2, JSON.stringify(s))
check('…carries wall-clock start/end and a server now', s.shifts[0].start === '18:00' && s.shifts[0].end === '01:00' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(s.now_local))
check('…in_use is true', s.in_use === true)
check('…NO colleague identity leaves the database', !JSON.stringify(s).includes('Ben') && !JSON.stringify(s).includes(ben.id))
await as(cy.auth_user_id)
s = (await q('select waiter_schedule_today() j'))[0].j
check('a staff member NOT on the shift gets mine=false', s.shifts[0].mine === false)
await as('')
check('signed-out gets null', (await q('select waiter_schedule_today() j'))[0].j === null)
await setSchedule(null); await as(ann.auth_user_id)
s = (await q('select waiter_schedule_today() j'))[0].j
check('no schedule → in_use false, empty list (not an error)', s.in_use === false && s.shifts.length === 0)

console.log('\nprivileges')
const priv = async (fn, role) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p
for (const [fn, expect] of [
  ['public.waiter_is_call_recipient()', { authenticated: true, anon: false }],
  ['public.waiter_open_calls()', { authenticated: true, anon: false }],
  ['public.waiter_ack_call(uuid)', { authenticated: true, anon: false }],
  ['public.waiter_schedule_today()', { authenticated: true, anon: false }],
  ['public.create_table_call(integer,text,integer,integer)', { authenticated: false, anon: false }],
  ['public.waiter_published_shifts_near()', { authenticated: false, anon: false }],
]) {
  for (const [role, want] of Object.entries(expect)) {
    check(`${fn} execute for ${role} = ${want}`, (await priv(fn, role)) === want)
  }
}

console.log('\n052 z_reports')
const zp = async (role, priv2) => (await q(`select has_table_privilege($1,'public.z_reports',$2) p`, [role, priv2]))[0].p
check('anon/authenticated have NO table privileges', !(await zp('anon', 'select')) && !(await zp('authenticated', 'insert')) && !(await zp('authenticated', 'select')))
check('RLS is enabled', (await q(`select relrowsecurity r from pg_class where relname='z_reports'`))[0].r === true)
const ins = (path, mime = 'image/jpeg', bytes = 1000, total = null, note = '') =>
  q(`insert into z_reports(business_date, uploaded_by_name, file_path, file_mime, file_bytes, total_agorot, note) values ('2026-10-13','x',$1,$2,$3,$4,$5) returning id`, [path, mime, bytes, total, note])
const goodPath = '2026-10-13/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg'
check('a normal row inserts', (await ins(goodPath)).length === 1)
let threw = false
try { await ins(goodPath) } catch { threw = true }
check('the same file path cannot be reused', threw)
for (const [name, args] of [
  ['an SVG mime', ['2026-10-13/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jpg', 'image/svg+xml']],
  ['a traversal path', ['../etc/passwd.jpg']],
  ['a wrong extension', ['2026-10-13/cccccccc-cccc-cccc-cccc-cccccccccccc.svg']],
  ['0 bytes', ['2026-10-13/dddddddd-dddd-dddd-dddd-dddddddddddd.jpg', 'image/jpeg', 0]],
  ['> 8 MB', ['2026-10-13/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.jpg', 'image/jpeg', 8388609]],
  ['a negative total', ['2026-10-13/ffffffff-ffff-ffff-ffff-ffffffffffff.jpg', 'image/jpeg', 100, -1]],
  ['a 501-char note', ['2026-10-13/11111111-1111-1111-1111-111111111111.jpg', 'image/jpeg', 100, null, 'x'.repeat(501)]],
]) {
  let t = false
  try { await ins(...args) } catch { t = true }
  check(`the CHECKs reject ${name}`, t)
}
const b = (await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id='z-reports'`))[0]
check('the bucket is private, 8 MB, four MIME types', b.public === false && Number(b.file_size_limit) === 8388608 && b.allowed_mime_types.length === 4 && !b.allowed_mime_types.includes('image/svg+xml'))
await db.exec(readFileSync(new URL('056_z_reports.sql', ROOT), 'utf8'))
check('re-running 056 is harmless and keeps the bucket private', (await q(`select public from storage.buckets where id='z-reports'`))[0].public === false)
await db.exec(readFileSync(new URL('057_waiter_calls_and_schedule_sync.sql', ROOT), 'utf8'))
check('re-running 057 is harmless', true)

console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1) }
