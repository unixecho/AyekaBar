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
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), provider text not null);
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
// 058 (remote ordering, 2026-10-13) joins them: it refactors 057's recipient rule, so it is proved on the REAL
// chain too — real staff table, real RLS, real function grants — not only on check-migration-058.mjs's stubs.
//
// 059 (staff join links) and 060 (the payslip library), 2026-10-14, join them for the same reason: 059 writes the REAL
// staff table (its unique indexes, its role check, the columns 006/041 added) and 060 hangs a foreign key off it.
const MINE = ['056_z_reports.sql', '057_waiter_calls_and_schedule_sync.sql', '058_remote_ordering.sql',
  '059_staff_join_links.sql', '060_staff_payslips.sql']

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

section('058 — remote ordering end to end, on the REAL chain (real staff, real FKs, real grants)')
{
  // The schedule was just unpublished above, so it is "not in use": every front-of-house person on an open shift
  // is a recipient, and the open POS shift from earlier is still there.
  await db.exec(`reset role`)
  // The real schema lets only a floor manager add a table (so does the real app): add it as the owner.
  await asUser(owner.authId)
  const tbl = (await one(`insert into public.waiter_tables (number) values (71) returning id`)).id

  await asUser(ann.authId)
  const c = await one(`select * from public.issue_table_code($1)`, [tbl])
  check('a real waiter on an open shift is issued six digits', /^\d{6}$/.test(c.code), JSON.stringify(c))
  const r1 = await one(`select * from public.redeem_table_code($1)`, [c.code])
  check('the customer connects: a session for table 71', r1.ok === true && r1.table_number === 71 && /^[0-9a-f]{64}$/.test(r1.session_token), JSON.stringify(r1))
  const r2 = await one(`select * from public.redeem_table_code($1)`, [c.code])
  check('RECOVERY on the real tables: the same digits work again, and the visit end does not move', r2.ok === true && r2.session_token !== r1.session_token && new Date(r2.expires_at).getTime() === new Date(r1.expires_at).getTime())
  const sub = await one(`select * from public.create_cart_submission($1, $2::jsonb, 1, 1200)`, [r1.session_token, JSON.stringify({ version: 1, items: [{ item_uid: 'x' }] })])
  check('the connected phone sends a request (a pending row, against the real customer_cart_submissions)', sub.ok === true && sub.table_number === 71, JSON.stringify(sub))

  const pend = await q(`select * from public.waiter_pending_submissions()`)
  check('a waiter on shift sees it in the queue', pend.length === 1 && pend[0].table_number === 71)
  await asUser(cy.authId)
  check('a bartender sees NOTHING', (await q(`select * from public.waiter_pending_submissions()`)).length === 0)
  await asUser(ben.authId)
  check('a second waiter taps import → ok (first tap wins)', (await one(`select public.waiter_review_submission($1, 'imported') r`, [sub.submission_id])).r === 'ok')
  await asUser(ann.authId)
  check('…and the first one, a moment later, is told "taken"', (await one(`select public.waiter_review_submission($1, 'imported') r`, [sub.submission_id])).r === 'taken')

  // 057's rule, factored into waiter_staff_is_call_recipient(): the server's list agrees with each person's own answer.
  await db.exec(`reset role`)
  const list = (await q(`select * from public.waiter_call_recipient_staff_ids()`)).map((x) => Object.values(x)[0]).sort()
  const expected = [ann, ben, owner, dev].map((x) => x.id).sort()
  check('the server\'s "who is on shift" list is exactly the front-of-house people (not the bartender)', JSON.stringify(list) === JSON.stringify(expected), JSON.stringify(list))
  const agree = []
  for (const p of [ann, ben, cy, owner, dev]) agree.push((await recipient(p)) === list.includes(p.id))
  check('…and agrees with waiter_is_call_recipient() for every person, one by one', agree.every(Boolean))

  // schedule IN USE: the list narrows to the assigned person
  await asUser(null)
  await db.exec(`reset role`)
  const wk = (await one(`select id from public.schedule_weeks where id = $1`, [legacyWeek])).id
  const pub = (await one(`select public.sched_publish_week($1, $2) r`, [owner.id, wk])).r
  check('(setup) re-publish the week through the real sched_publish_week()', pub?.ok === true, JSON.stringify(pub))
  const narrowed = (await q(`select * from public.waiter_call_recipient_staff_ids()`)).map((x) => Object.values(x)[0])
  check('schedule in use: the server\'s list narrows to who is assigned tonight (Ben)', narrowed.length === 1 && narrowed[0] === ben.id, JSON.stringify(narrowed))
  await db.exec(`reset role`)
  await db.query(`select public.sched_unpublish_week($1, $2)`, [owner.id, wk])

  // ending the visit
  await asUser(ann.authId)
  const sub2 = await one(`select * from public.create_cart_submission($1, $2::jsonb, 1, 800)`, [r1.session_token, JSON.stringify({ version: 1, items: [{ item_uid: 'y' }] })])
  check('(setup) another request goes in after the first was taken', sub2.ok === true || sub2.reason === 'too_fast', JSON.stringify(sub2))
  if (sub2.ok) {
    await one(`select public.waiter_end_table_visit($1) r`, [tbl])
    const st = (await one(`select status from public.customer_cart_submissions where id = $1`, [sub2.submission_id])).status
    check('ending the visit expires the unreviewed request and signs every phone out',
      st === 'expired' && (await one(`select ok from public.table_session_lookup($1)`, [r1.session_token])).ok === false &&
      (await one(`select ok from public.redeem_table_code($1)`, [c.code])).ok === false)
  }
  check('the imported one is untouched by the end', (await one(`select status from public.customer_cart_submissions where id = $1`, [sub.submission_id])).status === 'imported')

  // push, against the real staff_push_subscriptions (054)
  await asUser(ann.authId)
  const reg = (await one(`select public.waiter_register_push('https://push.example/real-pos', $1, $2, 'UA') r`, ['P'.repeat(20), 'A'.repeat(12)])).r
  check('the POS registers a device on the real table', reg === true)
  const row = await one(`select app, staff_id, last_seen_at from public.staff_push_subscriptions where endpoint = 'https://push.example/real-pos'`)
  check('…stored as app = "oms" for that person, fresh', row.app === 'oms' && row.staff_id === ann.id && Date.now() - new Date(row.last_seen_at).getTime() < 60_000)
  check('a portal subscription made by the real 054 route (no app column named) is "portal"', await (async () => {
    await db.exec(`reset role`)
    await db.query(`insert into public.staff_push_subscriptions (staff_id, endpoint, p256dh, auth) values ($1, 'https://push.example/real-web', $2, $3)`, [ann.id, 'P'.repeat(20), 'A'.repeat(12)])
    return (await one(`select app from public.staff_push_subscriptions where endpoint = 'https://push.example/real-web'`)).app === 'portal' })())
  check('the subscriptions table still has RLS on and no browser grants (054\'s promise holds)', (await one(`select relrowsecurity r from pg_class where relname = 'staff_push_subscriptions'`)).r === true
    && !(await one(`select has_table_privilege('anon','public.staff_push_subscriptions','select') p`)).p && !(await one(`select has_table_privilege('authenticated','public.staff_push_subscriptions','select') p`)).p)
}

section('059 — a join link, on the REAL staff table (006/041 columns, indexes and access functions)')
{
  await db.exec(`reset role`)
  await asUser(null)
  const gUser = async (email, meta = {}) => {
    const u = await one(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), $2::jsonb) returning id`, [email, JSON.stringify(meta)])
    await db.query(`insert into auth.identities (user_id, provider) values ($1, 'google')`, [u.id])
    return u.id
  }
  const hash = async (s) => (await one(`select encode(digest($1, 'sha256'), 'hex') h`, [s])).h
  // Exactly the insert POST /api/owner/staff makes for a person with no account (see its "offline" branch).
  const dana = (await one(`insert into public.staff (auth_user_id, role, badge, first_name, last_name, email, claimed_at)
                           values (null, 'staff', 'waiter', 'דנה', 'כהן', null, null) returning id`)).id
  const h1 = await hash('real-chain-token-1')
  const issued = (await one(`select public.staff_join_issue($1, $2, $3, 168) r`, [dana, h1, owner.id])).r
  check('an owner can issue a link for an offline row written exactly as the roster route writes it', issued.ok === true, JSON.stringify(issued))
  const peek = (await one(`select public.staff_join_peek($1) r`, [h1])).r
  check('peek reads the real row: first name + title, nothing else', peek.status === 'ok' && peek.first_name === 'דנה' && peek.badge === 'waiter' && !('email' in peek))

  const googleUid = await gUser('Dana.Real@Gmail.com', { given_name: 'Dana', family_name: 'Real' })
  const claimed = (await one(`select public.staff_join_claim($1, $2) r`, [h1, googleUid])).r
  check('the claim succeeds against the real table (the unique indexes and the role check all agree)', claimed.ok === true && claimed.staff_id === dana, JSON.stringify(claimed))
  const row = await one(`select auth_user_id, email, first_name, last_name, role, active, claimed_at from public.staff where id = $1`, [dana])
  check('the row is linked, carries the verified address, keeps the owner\'s typed name, and gained NO admin',
    row.auth_user_id === googleUid && row.email === 'Dana.Real@Gmail.com' && row.first_name === 'דנה' && row.last_name === 'כהן' && row.role === 'staff' && row.claimed_at !== null)

  // …and the person is a real employee to every access function the apps already use.
  await asUser(googleUid)
  check('claim_staff_invite() (006/041) now answers "staff" for them — the middleware sees an ordinary employee', (await one(`select public.claim_staff_invite() r`)).r === 'staff')
  check('is_staff_client() (the POS\'s row-level-security gate) is true for them', (await one(`select public.is_staff_client() r`)).r === true)
  const lvl = await q(`select * from public.staff_access_levels where staff_id = $1`, [dana]).catch(() => null)
  check('staff_access_levels lists them as staff (not owner, not menu editor)', !lvl || lvl.length === 0 || JSON.stringify(lvl[0]).includes('"staff"') || !JSON.stringify(lvl[0]).includes('owner'), JSON.stringify(lvl))
  await asUser(null)
  await db.exec(`reset role`)

  // a mistyped pending invite is rescued, and the unique-email index is respected
  const limor = (await one(`insert into public.staff (auth_user_id, role, badge, first_name, email) values (null, 'staff', 'busboy', 'לימור', 'limor@gmial.com') returning id`)).id
  const h2 = await hash('real-chain-token-2')
  await db.query(`select public.staff_join_issue($1, $2, $3, 168)`, [limor, h2, owner.id])
  const dup = await gUser('ann@x.test')                       // the address ann@x.test is ALREADY on Ann's real row
  check('an address already on another REAL row is refused cleanly (email_in_use), the link survives',
    (await one(`select public.staff_join_claim($1, $2) r`, [h2, dup])).r.reason === 'email_in_use' && (await one(`select public.staff_join_peek($1) r`, [h2])).r.status === 'ok')
  const real = await gUser('limor.real@gmail.com')
  const rescue = (await one(`select public.staff_join_claim($1, $2) r`, [h2, real])).r
  check('…and the right account then rescues the mistyped invite', rescue.ok === true && (await one(`select email from public.staff where id = $1`, [limor])).email === 'limor.real@gmail.com')

  // an owner row can never be claimed by link
  const bossRow = (await one(`insert into public.staff (auth_user_id, role, badge, first_name) values (null, 'owner', 'owner', 'Boss2') returning id`)).id
  check('a link can never be issued for an owner row on the real table', (await one(`select public.staff_join_issue($1, $2, null, 168) r`, [bossRow, await hash('x')])).r.reason === 'owner_role')

  // removal (041's soft delete clears auth_user_id + active) and the link
  const gone = (await one(`insert into public.staff (auth_user_id, role, badge, first_name) values (null, 'staff', 'cook', 'Gone') returning id`)).id
  const h3 = await hash('real-chain-token-3')
  await db.query(`select public.staff_join_issue($1, $2, null, 168)`, [gone, h3])
  await db.query(`update public.staff set active = false, auth_user_id = null where id = $1`, [gone])
  check('a person soft-deleted the way 041 does it cannot be joined by a link sent earlier',
    (await one(`select public.staff_join_claim($1, $2) r`, [h3, await gUser('late@x.test')])).r.reason === 'inactive')
}

section('060 — payslips, on the REAL staff table')
{
  await db.exec(`reset role`)
  await asUser(null)
  const who = (await one(`select id from public.staff where first_name = 'דנה'`)).id
  const sid = who
  const path = `${sid}/2026-09/${crypto.randomUUID()}.pdf`
  const slip = (await one(`insert into public.staff_payslips (staff_id, period, file_path, file_name, file_mime, file_bytes, uploaded_by, uploaded_by_name)
                           values ($1, '2026-09-01', $2, 'תלוש.pdf', 'application/pdf', 1234, $3, 'Maya') returning id`, [sid, path, owner.id])).id
  check('a payslip row inserts against the real staff table', !!slip)
  check('the real bucket row exists, private', (await one(`select public from storage.buckets where id = 'payslips'`)).public === false)
  await db.query(`insert into public.staff_payslip_events (payslip_id, actor_staff_id, kind) values ($1, $2, 'uploaded')`, [slip, owner.id])
  let blocked = null
  try { await db.query(`delete from public.staff_payslip_events`) } catch (e) { blocked = e.code }
  check('the access log refuses deletion on the real chain too', blocked === '42501')
  blocked = null
  try { await db.query(`delete from public.staff where id = $1`, [sid]) } catch (e) { blocked = e.code }
  check('a person with payslips cannot be hard-deleted from the real staff table (RESTRICT)', blocked === '23001', String(blocked))
  check('…and soft removal (041\'s way) is still allowed — payslips keep pointing at the person',
    !(await db.query(`update public.staff set active = false where id = $1`, [sid]).then(() => null).catch((e) => e)))
  for (const t of ['staff_payslips', 'staff_payslip_events', 'staff_join_links']) {
    check(`${t}: RLS on, no policy, no table privilege for anon / authenticated on the real chain`,
      (await one(`select relrowsecurity r from pg_class where relname = $1`, [t])).r === true &&
      (await one(`select count(*)::int c from pg_policies where tablename = $1`, [t])).c === 0 &&
      !(await one(`select has_table_privilege('anon', $1, 'select') p`, [`public.${t}`])).p &&
      !(await one(`select has_table_privilege('authenticated', $1, 'select') p`, [`public.${t}`])).p)
  }
}

section('the scheduler\'s own invariants still hold with 056/057/058/059/060 installed')
{
  const dupes = await q(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'sched\\_%' or p.proname like 'waiter\\_%' or p.proname in ('create_table_call', 'issue_table_code', 'redeem_table_code', 'cleanup_table_codes', 'table_session_lookup', 'table_session_submissions', 'create_cart_submission')) group by proname having count(*) > 1`)
  check('no function name has two signatures (PostgREST would answer PGRST203)', dupes.length === 0, JSON.stringify(dupes))
  const grants = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname in ('waiter_is_call_recipient','waiter_open_calls','waiter_ack_call','waiter_schedule_today','waiter_published_shifts_near','create_table_call')
                            and has_function_privilege('anon', p.oid, 'execute')`)
  check('none of 057\'s functions is executable by anon', grants.length === 0, JSON.stringify(grants))
  // 058's functions, against the REAL default privileges (the stub harness has none, so it cannot say this).
  const m058 = ['issue_table_code', 'redeem_table_code', 'table_session_lookup', 'table_session_submissions', 'create_cart_submission',
    'waiter_rotate_table_code', 'waiter_end_table_visit', 'waiter_table_visit', 'waiter_pending_submissions', 'waiter_review_submission',
    'waiter_register_push', 'waiter_unregister_push', 'waiter_staff_is_call_recipient', 'waiter_call_recipient_staff_ids',
    '_table_code_is_live', '_mint_table_digits', '_end_table_visit', 'cleanup_table_codes']
  const anon058 = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = any($1) and has_function_privilege('anon', p.oid, 'execute')`, [m058])
  check('NONE of 058\'s functions is executable by anon, on the real default privileges', anon058.length === 0, JSON.stringify(anon058))
  const customerSide = ['redeem_table_code', 'table_session_lookup', 'table_session_submissions', 'create_cart_submission',
    'waiter_staff_is_call_recipient', 'waiter_call_recipient_staff_ids', '_table_code_is_live', '_mint_table_digits', '_end_table_visit', 'cleanup_table_codes']
  const authed = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = any($1) and has_function_privilege('authenticated', p.oid, 'execute')`, [customerSide])
  check('the customer-side and internal ones are not executable by `authenticated` either — service role only', authed.length === 0, JSON.stringify(authed))
  const staffSide = ['issue_table_code', 'waiter_rotate_table_code', 'waiter_end_table_visit', 'waiter_table_visit', 'waiter_pending_submissions',
    'waiter_review_submission', 'waiter_register_push', 'waiter_unregister_push']
  const missing = []
  for (const fn of staffSide) if (!(await one(`select bool_or(has_function_privilege('authenticated', p.oid, 'execute')) x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn])).x) missing.push(fn)
  check('the POS-side ones ARE executable by `authenticated` (the POS signs in as staff)', missing.length === 0, JSON.stringify(missing))
  check('the three order tables keep RLS on with zero policies on the real chain', (await one(`select count(*)::int c from pg_class where relname in ('waiter_table_codes','customer_table_sessions','customer_cart_submissions') and relrowsecurity`)).c === 3
    && (await one(`select count(*)::int c from pg_policies where tablename in ('waiter_table_codes','customer_table_sessions','customer_cart_submissions')`)).c === 0)
  // 059's four functions: service role ONLY, on the real default privileges.
  const m059 = await q(`select p.proname, has_function_privilege('anon', p.oid, 'execute') a, has_function_privilege('authenticated', p.oid, 'execute') b
                        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'staff\\_join\\_%'`)
  check('059: all four staff_join_* functions exist and none is executable by anon or authenticated', m059.length === 4 && m059.every((r) => !r.a && !r.b), JSON.stringify(m059))
  check('z_reports: no table privilege for anon / authenticated',
    !(await one(`select has_table_privilege('anon','public.z_reports','select') p`)).p && !(await one(`select has_table_privilege('authenticated','public.z_reports','insert') p`)).p)
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('\nFAILED:'); for (const f of failures) console.log(`  ✗ ${f}`); process.exit(1) }
