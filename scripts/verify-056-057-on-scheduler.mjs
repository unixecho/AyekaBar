#!/usr/bin/env node
// Do migrations 056 (Z reports) and 057 (waiter calls + the POS reading the
// schedule) work ON TOP OF the rebuilt scheduler (052–055)? Run offline against
// an in-memory Postgres (PGlite) — nothing here touches any Supabase project.
//
//   node scripts/verify-056-057-on-scheduler.mjs
//
// WHY THIS EXISTS, SEPARATE FROM check-migrations-056-057.mjs. That one stubs the
// handful of tables 056/057 reference, which proves their own logic but not
// that they agree with the REAL scheduler. 057 reads `schedule_weeks.
// published_snapshot`, whose shape the scheduler rebuild (PR #6, 2026-10-12)
// changed from nested/camelCase to flat/snake_case. So this applies EVERY real
// migration in order (000 … 055), then 056 and 057, then drives the scheduler's
// own functions: it plants a legacy week in 027's nested shape, lets 052 convert
// it, publishes a new week through the real `sched_publish_week()`, and asks
// 057's functions who is on shift — on both the converted-legacy and the
// freshly-published snapshots. The setup mirrors scripts/verify-schedule-sql.mjs
// (the scheduler's own harness), which is the authority on how to stand a
// Supabase-shaped database up in PGlite.
//
// Run it away from 23:30–00:30 Israel time: it places a shift "an hour ago to
// three hours from now" on today's date, which wraps past midnight otherwise.

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIG = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
const db = new PGlite({ extensions: { pgcrypto } })

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const q = async (sql, params) => (await db.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const asUser = (authId) => db.exec(`select set_config('request.jwt.claim.sub', '${authId ?? ''}', false)`)

// ---- Stand-ins for what Supabase provides (as in verify-schedule-sql.mjs) -----
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create schema storage;
  create schema cron;
  create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create function cron.unschedule(a bigint) returns boolean language sql as $$ select true $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text);
  alter table storage.objects enable row level security;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
`)

const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
const stripCron = (sql) => sql.replace(/create extension if not exists pg_cron[^;]*;/g, '')
const LEGACY = files.filter((f) => f < '052_')
const SCHEDULER = files.filter((f) => /^05[2-5]_/.test(f))
const MINE = ['056_z_reports.sql', '057_waiter_calls_and_schedule_sync.sql']

section('migrations apply in order')
for (const f of LEGACY) {
  try { await db.exec(stripCron(readFileSync(MIG + f, 'utf8'))) } catch (e) { check(`apply ${f}`, false, String(e.message).split('\n')[0]); process.exit(1) }
}
check(`apply 000 … 051 (${LEGACY.length} files — the schema production holds today)`, true)

async function addStaff({ email, first, role = 'staff', badge = null }) {
  const authId = (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id
  const s = await one(
    `insert into public.staff (auth_user_id, email, first_name, role, badge, active, claimed_at) values ($1,$2,$3,$4,$5,true,now()) returning id`,
    [authId, email, first, role, badge])
  return { id: s.id, authId }
}
const venue = (await one(`select id from public.venues where slug = 'ayeka-bar'`)).id
const ann = await addStaff({ email: 'ann@x.test', first: 'Ann', badge: 'waiter' })
const ben = await addStaff({ email: 'ben@x.test', first: 'Ben', badge: 'manager' })
const cy = await addStaff({ email: 'cy@x.test', first: 'Cy', badge: 'bartender' })
const owner = await addStaff({ email: 'owner@x.test', first: 'Maya', role: 'owner', badge: 'owner' })
const dev = await addStaff({ email: 'dev@x.test', first: 'Dev', role: 'owner', badge: 'Dev' })

// today / now, as Postgres sees them in Jerusalem — never via a JS Date round trip
const t = await one(`select to_char((now() at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') d,
                            (now() at time zone 'Asia/Jerusalem')::date - extract(dow from (now() at time zone 'Asia/Jerusalem')::date)::int as sunday,
                            to_char(((now() at time zone 'Asia/Jerusalem') - interval '60 minutes'), 'HH24:MI') s,
                            to_char(((now() at time zone 'Asia/Jerusalem') + interval '180 minutes'), 'HH24:MI') e`)
const today = t.d, weekStart = (await one(`select to_char($1::date, 'YYYY-MM-DD') d`, [t.sunday])).d

// ---- a LEGACY week in 027's nested shape, planted BEFORE 052 converts it --------
const legacyWeek = (await one(
  `insert into public.schedule_weeks (venue_id, week_start, status, version, published_at) values ($1, $2, 'published', 1, now()) returning id`,
  [venue, weekStart])).id
const legacyShift = (await one(
  `insert into public.shifts (venue_id, week_id, shift_date, start_time, end_time) values ($1, $2, $3, $4, $5) returning id`,
  [venue, legacyWeek, today, t.s, t.e])).id
const legacyAsg = (await one(
  `insert into public.shift_assignments (venue_id, shift_id, staff_id, staff_name, role_id) values ($1, $2, $3, 'Ann', 'waiter') returning id`,
  [venue, legacyShift, ann.id])).id
await db.query(`update public.schedule_weeks set published_snapshot = $2::jsonb where id = $1`, [legacyWeek, JSON.stringify({
  shifts: [{ id: legacyShift, date: today, start: t.s, end: t.e, presetId: null, stationId: null, requirements: [], note: '',
    assignments: [{ id: legacyAsg, staffId: ann.id, staffName: 'Ann', roleId: 'waiter', status: 'assigned' }] }],
})])

for (const f of SCHEDULER) { try { await db.exec(readFileSync(MIG + f, 'utf8')); check(`apply ${f}`, true) } catch (e) { check(`apply ${f}`, false, String(e.message).split('\n')[0]); process.exit(1) } }
for (const f of MINE) { try { await db.exec(readFileSync(MIG + f, 'utf8')); check(`apply ${f}  (on top of the rebuilt scheduler)`, true) } catch (e) { check(`apply ${f}`, false, String(e.message).split('\n')[0]); process.exit(1) } }

// an open POS shift, as 057 requires
await db.exec(`delete from public.waiter_shift_sessions; insert into public.waiter_shift_sessions (status) values ('active')`)
const recipient = async (staff) => { await asUser(staff.authId); return (await one(`select public.waiter_is_call_recipient() r`)).r }

section('057 reads the snapshot the scheduler REBUILD produces')
{
  // 052 converted the nested legacy snapshot in place; read it through 057.
  const snap = (await one(`select published_snapshot s from public.schedule_weeks where id = $1`, [legacyWeek])).s
  check('052 converted the planted legacy snapshot to the flat shape (precondition)', Array.isArray(snap.assignments) && snap.shifts[0].shift_date === today, JSON.stringify(snap).slice(0, 160))
  const near = await q(`select shift_date::text d, to_char(start_ts,'HH24:MI') s, to_char(end_ts,'HH24:MI') e, assignments from public.waiter_published_shifts_near()`)
  check('057 sees that converted shift, with its times', near.length === 1 && near[0].d === today && near[0].s === t.s, JSON.stringify(near))
  check('…and its assignee, normalised to {staffId, roleId}', near[0].assignments[0].staffId === ann.id && near[0].assignments[0].roleId === 'waiter', JSON.stringify(near[0].assignments))
  check('the scheduler is "in use" → only the assigned waiter is a recipient', (await recipient(ann)) === true && (await recipient(ben)) === false && (await recipient(dev)) === false)
  check('a bartender is never a recipient, schedule or not', (await recipient(cy)) === false)
}

section('a week published through the scheduler\'s own sched_publish_week()')
{
  // Add a second shift in the same week + publish the whole week for real.
  await db.query(`delete from public.shift_assignments where shift_id = $1`, [legacyShift])
  await db.query(`delete from public.shifts where id = $1`, [legacyShift])
  const live = (await one(`insert into public.shifts (venue_id, week_id, shift_date, start_time, end_time) values ($1,$2,$3,$4,$5) returning id`, [venue, legacyWeek, today, t.s, t.e])).id
  // Ben (the shift manager) works tonight; Ann does not.
  await db.query(`insert into public.shift_assignments (venue_id, shift_id, staff_id, staff_name, role_id) values ($1,$2,$3,'Ben','shift_leader')`, [venue, live, ben.id])
  await db.exec(`reset role`)
  const pub = (await one(`select public.sched_publish_week($1, $2) r`, [owner.id, legacyWeek])).r
  check('sched_publish_week() succeeds', pub?.ok === true, JSON.stringify(pub))
  const snap = (await one(`select published_snapshot s from public.schedule_weeks where id = $1`, [legacyWeek])).s
  check('the freshly published snapshot is FLAT: shifts[] + assignments[] joined by shift_id',
    Array.isArray(snap.shifts) && Array.isArray(snap.assignments) && snap.assignments[0].shift_id === live && snap.assignments[0].staff_id === ben.id)
  check('…and the time columns come out as plain "HH:MM" text', /^\d\d:\d\d$/.test(snap.shifts[0].start_time), snap.shifts[0].start_time)
  check('057 now says Ben (assigned) is a recipient and Ann (no longer assigned) is not',
    (await recipient(ben)) === true && (await recipient(ann)) === false)
  check('the owner/dev are not recipients unless assigned, once a schedule is in use', (await recipient(owner)) === false && (await recipient(dev)) === false)

  await asUser(ben.authId)
  const today_ = (await one(`select public.waiter_schedule_today() j`)).j
  check('waiter_schedule_today(): the shift, mine=true for Ben, with a count and NO names',
    today_.shifts.length === 1 && today_.shifts[0].mine === true && today_.shifts[0].people === 1 && !JSON.stringify(today_).includes('Ann') && today_.in_use === true, JSON.stringify(today_))
  await asUser(ann.authId)
  check('…and mine=false for Ann', (await one(`select public.waiter_schedule_today() j`)).j.shifts[0].mine === false)

  // unpublish → the schedule is "not in use" again → the fallback applies
  await db.exec(`reset role`)
  const un = (await one(`select public.sched_unpublish_week($1, $2) r`, [owner.id, legacyWeek])).r
  check('sched_unpublish_week() succeeds', un?.ok === true, JSON.stringify(un))
  check('unpublished means NOT in use: every front-of-house person on an open shift is a recipient again',
    (await recipient(ann)) === true && (await recipient(ben)) === true && (await recipient(dev)) === true && (await recipient(cy)) === false)
}

section('the scheduler\'s own invariants still hold with 056/057 installed')
{
  const dupes = await q(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'sched\\_%' or p.proname like 'waiter\\_%' or p.proname = 'create_table_call') group by proname having count(*) > 1`)
  check('no function name has two signatures (PostgREST would answer PGRST203)', dupes.length === 0, JSON.stringify(dupes))
  const grants = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname in ('waiter_is_call_recipient','waiter_open_calls','waiter_ack_call','waiter_schedule_today','waiter_published_shifts_near','create_table_call')
                            and has_function_privilege('anon', p.oid, 'execute')`)
  check('none of 057\'s functions is executable by anon', grants.length === 0, JSON.stringify(grants))
  check('z_reports: no table privilege for anon / authenticated',
    !(await one(`select has_table_privilege('anon','public.z_reports','select') p`)).p && !(await one(`select has_table_privilege('authenticated','public.z_reports','insert') p`)).p)
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('\nFAILED:'); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1) }
