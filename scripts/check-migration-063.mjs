#!/usr/bin/env node
// Does migration 063 close what it says and leave every real user working? Offline, in an in-memory Postgres (PGlite),
// with EVERY real migration applied in order and Supabase's default grants modelled, so "anon had everything" starts true.
//
//   node scripts/check-migration-063.mjs
//
// Each claim runs as the real role (anon, a stranger's Google account, a waiter, the owner, the service role).

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

await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema storage; create schema cron; create schema vault; create schema net;
  create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
  create function cron.unschedule(a bigint) returns boolean language sql as $$ select true $$;
  create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text);
  alter table storage.objects enable row level security;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz default now());
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), provider text not null default 'google');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  -- Supabase's own defaults: every new table is fully granted to these roles.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`)

const stripCron = (sql) => sql.replace(/create extension if not exists pg_cron[^;]*;/g, '')
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()
const before = files.filter((f) => f < '063_')

section('the real migration chain applies')
for (const f of before) {
  try { await db.exec(stripCron(readFileSync(MIG + f, 'utf8'))) } catch (e) { check(`apply ${f}`, false, String(e.message).split('\n')[0]); process.exit(1) }
}
check(`apply 000 … 062 (${before.length} files)`, true)
for (const t of ['staff', 'customers', 'waiter_orders']) {
  // Production's starting point, as measured 2026-11-03: anon held table grants on these.
  await db.exec(`grant all on public.${t} to anon`)
}

async function addStaff(email, first, role, badge) {
  const authId = (await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).rows[0].id
  const id = (await db.query(
    `insert into public.staff (auth_user_id, email, first_name, role, badge, active, claimed_at) values ($1,$2,$3,$4,$5,true,now()) returning id`,
    [authId, email, first, role, badge])).rows[0].id
  return { id, authId }
}
const waiter = await addStaff('w@x.test', 'Wen', 'staff', 'waiter')
const owner = await addStaff('o@x.test', 'Oz', 'owner', 'owner')
const strangerId = (await db.query(`insert into auth.users (email) values ('s@x.test') returning id`)).rows[0].id
const customerAuth = (await db.query(`insert into auth.users (email) values ('c@x.test') returning id`)).rows[0].id
const customer = (await db.query(`insert into public.customers (auth_user_id, email) values ($1, 'c@x.test') returning id`, [customerAuth])).rows[0].id
const tableId = (await db.query(`insert into public.waiter_tables (number) values (77) returning id`)).rows[0].id
await db.exec(`delete from public.waiter_shift_sessions; insert into public.waiter_shift_sessions (status) values ('active')`)

section('apply 063')
try { await db.exec(readFileSync(MIG + '063_security_hardening.sql', 'utf8')); check('063 applies on the real chain', true) } catch (e) { check('063 applies', false, e.message); process.exit(1) }
try { await db.exec(readFileSync(MIG + '063_security_hardening.sql', 'utf8')); check('…and is safe to run twice', true) } catch (e) { check('…and is safe to run twice', false, e.message) }

/** Runs sql AS a role in a transaction that always rolls back. Returns rows, or { denied, message }. */
async function as(role, authId, sql, params) {
  await db.exec(`begin; select set_config('request.jwt.claim.sub', '${authId ?? ''}', true); set local role ${role};`)
  try {
    const r = await db.query(sql, params)
    return { rows: r.rows, affected: r.affectedRows }
  } catch (e) {
    return { denied: e.code === '42501', code: e.code, message: e.message }
  } finally {
    await db.exec('rollback')
  }
}
const denied = async (role, id, sql, params) => (await as(role, id, sql, params)).denied === true
const works = async (role, id, sql, params) => { const r = await as(role, id, sql, params); return { ok: !r.code, ...r } }

section('anon: only the public reads survive')
for (const t of ['public_menus', 'public_menu_variants', 'app_settings', 'rewards', 'menu_variants']) {
  const r = await works('anon', null, `select count(*) from public.${t}`)
  check(`anon can still read ${t}`, r.ok, r.message)
}
for (const t of ['staff', 'customers', 'admins', 'waiter_orders', 'waiter_tables', 'waiter_table_codes', 'customer_table_sessions',
  'loyalty_qr_tokens', 'fraud_log', 'rate_limits', 'menu_audit', 'schedule_roster', 'waiter_staff_directory', 'published_schedule', 'shifts', 'venues']) {
  check(`anon is refused ${t}`, await denied('anon', null, `select count(*) from public.${t}`))
}
check('anon cannot write the public settings', await denied('anon', null, `update public.app_settings set is_public = is_public`))
for (const f of ['is_op()', 'is_staff_client()', 'claim_staff_invite()', 'current_shift_status()', 'current_staff_id()']) {
  check(`anon cannot call ${f}`, await denied('anon', null, `select * from public.${f} offset 0`))
}
check('anon cannot call a trigger function', await denied('anon', null, `select public.waiter_tables_guard()`))
check('anon cannot call publish_menu', await denied('anon', null, `select public.publish_menu(gen_random_uuid())`))

section('a stranger with a Google account gets nothing new')
{
  const r = await works('authenticated', strangerId, `select public.is_staff_client() s, public.is_op() o`)
  check('helper functions still run and answer false', r.ok && r.rows[0].s === false && r.rows[0].o === false, r.message)
  check('no staff rows visible', (await as('authenticated', strangerId, `select * from public.staff`)).rows?.length === 0)
  check('cannot create a customer with points', await denied('authenticated', strangerId, `insert into public.customers (auth_user_id, points) values ($1, 999)`, [strangerId]))
  check('cannot make themselves staff', await denied('authenticated', strangerId, `insert into public.staff (auth_user_id, role) values ($1, 'owner')`, [strangerId]))
  check('cannot edit a setting', await denied('authenticated', strangerId, `update public.app_settings set is_public = true`))
  for (const t of ['fraud_log', 'rate_limits', 'loyalty_qr_tokens', 'waiter_table_codes', 'customer_cart_submissions', 'waiter_table_calls']) {
    check(`refused ${t} outright`, await denied('authenticated', strangerId, `select count(*) from public.${t}`))
  }
  check('TRUNCATE is refused', await denied('authenticated', strangerId, `truncate public.rate_limits`))
  check('claim_staff_invite still runs for a signed-in person', (await works('authenticated', strangerId, `select public.claim_staff_invite()`)).ok)
}

section('a customer keeps their own account')
{
  const mine = await as('authenticated', customerAuth, `select id from public.customers`)
  check('reads their own row', mine.rows?.length === 1 && mine.rows[0].id === customer, mine.message)
  check('cannot change their points', await denied('authenticated', customerAuth, `update public.customers set points = 999`))
  check('cannot delete their row directly', await denied('authenticated', customerAuth, `delete from public.customers`))
}

section('a waiter can still work a shift')
{
  const read = await works('authenticated', waiter.authId, `select id from public.waiter_tables`)
  check('reads tables', read.ok && read.rows.length >= 1, read.message)
  const hold = await works('authenticated', waiter.authId, `update public.waiter_tables set held_by_staff_id = $1 where id = $2`, [waiter.id, tableId])
  check('claims a table', hold.ok, hold.message)
  const open = await works('authenticated', waiter.authId, `insert into public.waiter_orders (table_id) values ($1) returning id`, [tableId])
  check('opens an order (the insert triggers still fire)', open.ok, open.message)
  const move = await as('authenticated', waiter.authId, `update public.waiter_tables set pos_x = 1 where id = $1`, [tableId])
  check('the floor guard TRIGGER still refuses a layout edit, though its function is closed to direct calls',
    /only a floor manager/.test(move.message ?? ''), JSON.stringify(move))
  check('cannot call that trigger function by name', await denied('authenticated', waiter.authId, `select public.waiter_tables_guard()`))
  const dir = await works('authenticated', waiter.authId, `select count(*) from public.waiter_staff_directory`)
  check('still resolves colleagues\' names', dir.ok, dir.message)
  const sched = await works('authenticated', waiter.authId, `select public.waiter_schedule_today()`)
  check('the POS schedule function is untouched', sched.ok, sched.message)
  const status = await works('authenticated', waiter.authId, `select * from public.current_shift_status()`)
  check('current_shift_status still works when signed in (the POS calls it)', status.ok && status.rows[0].is_active === true, status.message)
  for (const t of ['waiter_orders', 'waiter_order_items', 'waiter_order_events', 'waiter_tables', 'waiter_shift_reports']) {
    check(`cannot DELETE from ${t}`, await denied('authenticated', waiter.authId, `delete from public.${t}`))
  }
}

section('the owner keeps the menu')
{
  const r = await works('authenticated', owner.authId, `update public.menus set name = name`)
  check('updates menus', r.ok, r.message)
  check('publish_menu is callable', (await as('authenticated', owner.authId, `select public.publish_menu(gen_random_uuid())`)).denied !== true)
}

section('award_points')
{
  const biz = '00000000-0000-0000-0000-000000000001'
  await db.query(`insert into public.loyalty_qr_tokens (token, business_id, expires_at) values ('t1', $1, now() + interval '5 min')`, [biz])
  await db.query(`insert into public.loyalty_qr_tokens (token, business_id, expires_at) values ('t2', $1, now() + interval '5 min')`, [biz])
  const award = (t) => db.query(`set local role service_role; `).catch(() => {}).then(() => db.query(`select public.award_points($1, $2) r`, [t, customer]))
  check('the first scan earns the point', (await award('t1')).rows[0].r.success === true)
  const replay = (await award('t1')).rows[0].r
  check('the same code is refused the second time', replay.error === 'token_already_used', JSON.stringify(replay))
  const other = (await award('t2')).rows[0].r
  check('a second code inside 24 hours is refused', other.error === 'cooldown_active', JSON.stringify(other))
  const points = (await db.query(`select points from public.customers where id = $1`, [customer])).rows[0].points
  check('exactly one point was awarded', points === 1, String(points))
  const sql = readFileSync(MIG + '063_security_hardening.sql', 'utf8')
  check('it locks the customer and the token', /from public\.customers where id = p_customer_id for update/.test(sql) && /where token = p_token\s+for update/.test(sql))
  check('only the service role may call it', await denied('authenticated', customerAuth, `select public.award_points('x', $1)`, [customer]))
  const svc = await works('service_role', null, `select public.award_points('nope', $1) r`, [customer])
  check('the service role can', svc.ok && svc.rows[0].r.error === 'token_not_found', svc.message)
}

section('new objects are closed by default')
{
  await db.exec(`create table public.zz_future (id int primary key); create function public.zz_fn() returns int language sql as 'select 1';`)
  check('a future table is closed to anon', await denied('anon', null, `select * from public.zz_future`))
  check('a future function is closed to anon', await denied('anon', null, `select public.zz_fn() offset 0`))
  const rls = await db.query(`select reloptions from pg_class where oid = 'public.schedule_roster'::regclass`)
  check('schedule_roster carries a security barrier', (rls.rows[0].reloptions ?? []).some((o) => /security_barrier=true/.test(o)))
  const open = await db.query(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`)
  check('no SECURITY DEFINER function is left callable by anon', open.rows.length === 0, open.rows.map((r) => r.proname).join(', '))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('FAILED:'); failures.forEach((f) => console.log(`  ${f}`)); process.exit(1) }
