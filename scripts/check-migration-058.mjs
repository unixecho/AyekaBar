#!/usr/bin/env node
// Offline test of migration 058 (REMOTE ORDERING) against an in-memory Postgres —
// PGlite, WebAssembly, no Docker. It applies the REAL 048, 049, 057 and 058 files,
// stubbing only what they reference (auth.uid(), staff, waiter_tables,
// waiter_orders, customers, menu_audit, app_settings, waiter_shift_sessions,
// schedule_weeks, staff_push_subscriptions, is_staff_client()).
//
//   node scripts/check-migration-058.mjs
//
// WHY IT EXISTS: there is no local Supabase stack here (no Docker) and CLAUDE.md
// forbids applying a migration without the owner's per-migration approval, so the
// only way to know a drafted migration does what its comments claim BEFORE asking
// for that approval is to run it somewhere harmless.
//
// WHAT IT PROVES — the three claims 058 makes that matter:
//   1. RECOVERABLE, BUT BOUNDED: the same digits work again (new device / cleared
//      cookie), never extend the visit, are capped at 6 devices, die on rotate /
//      end / replace / expiry, and only the hash is ever stored;
//   2. A SUBMISSION IS A REQUEST: capped (3 pending, one per 20s), needs a live
//      session and an open shift, is visible to the whole visit, never an order,
//      and "first tap wins" for staff review;
//   3. EVERY GRANT is what the header says (the customer-side functions go to
//      NOBODY but service_role; nothing at all to anon).
// Plus the recipient rule that 058 FACTORED out of 057 still answers the same.
//
// WHAT IT CANNOT PROVE: production's real grants/RLS/advisors (verify those after
// applying: get_advisors, has_function_privilege) and true concurrency (one
// connection) — the first-redemption race is decided by the UPDATE itself, which
// is reasoned about in the migration, not raced here.
//
// Run it away from 23:30–00:30 Israel time (the scheduled-shift cases build times
// relative to "now" and wrap onto another date there).

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../supabase/migrations/', import.meta.url)
const db = new PGlite({ extensions: { pgcrypto } })

let pass = 0
const fails = []
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ✓', n) } else { fails.push(n); console.log('  ✗', n, d) } }
const section = (s) => console.log(`\n${s}`)
const q = async (sql, params) => (await db.query(sql, params)).rows
const as = async (uid) => db.exec(`select set_config('test.uid', '${uid ?? ''}', false)`)
const threw = async (sql, params) => { try { await q(sql, params); return null } catch (e) { return e } }

// ── stubs ──────────────────────────────────────────────────────────────
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create extension pgcrypto with schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.staff (id uuid primary key default gen_random_uuid(), auth_user_id uuid, role text, badge text, active boolean default true, first_name text);
  create function public.is_staff_client() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.staff s where s.auth_user_id = auth.uid() and s.active) $$;
  create table public.waiter_tables (id uuid primary key default gen_random_uuid(), number integer unique not null, active boolean default true);
  create table public.waiter_orders (id uuid primary key default gen_random_uuid());
  create table public.customers (id uuid primary key default gen_random_uuid());
  create table public.menu_audit (id uuid primary key default gen_random_uuid(), action text);
  create table public.app_settings (key text primary key, value jsonb not null, is_public boolean default false);
  create table public.waiter_shift_sessions (id uuid primary key default gen_random_uuid(), status text not null default 'active');
  create table public.schedule_weeks (id uuid primary key default gen_random_uuid(), week_start date, status text, published_snapshot jsonb);
  create table public.staff_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    staff_id uuid not null references public.staff(id) on delete cascade,
    endpoint text not null unique, p256dh text not null, auth text not null, user_agent text,
    created_at timestamptz not null default now(), last_seen_at timestamptz not null default now());
`)

section('the real files apply')
for (const f of ['048_customer_table_ordering_groundwork.sql', '049_correct_table_code_attempt_counter_claim.sql',
                 '057_waiter_calls_and_schedule_sync.sql', '058_remote_ordering.sql']) {
  try { await db.exec(readFileSync(new URL(f, ROOT), 'utf8')); check(`${f} applies cleanly`, true) }
  catch (e) { check(`${f} applies cleanly`, false, e.message) }
}
try { await db.exec(readFileSync(new URL('058_remote_ordering.sql', ROOT), 'utf8')); check('058 is idempotent (re-run is harmless)', true) }
catch (e) { check('058 is idempotent (re-run is harmless)', false, e.message) }

// ── people, tables, a shift ────────────────────────────────────────────
const mkStaff = async (role, badge, active = true) =>
  (await q(`insert into staff(auth_user_id, role, badge, active) values (gen_random_uuid(), $1, $2, $3) returning id, auth_user_id`, [role, badge, active]))[0]
const ann = await mkStaff('staff', 'waiter')
const ben = await mkStaff('staff', 'manager')
const cy = await mkStaff('staff', 'bartender')
const dev = await mkStaff('owner', 'Dev')
const gone = await mkStaff('staff', 'waiter', false)
const T = {}
for (const n of [7, 9, 10, 11]) T[n] = (await q(`insert into waiter_tables(number) values ($1) returning id`, [n]))[0].id
const T8 = (await q(`insert into waiter_tables(number, active) values (8, false) returning id`))[0].id
const openShift = () => db.exec(`delete from waiter_shift_sessions; insert into waiter_shift_sessions(status) values ('active')`)
const closeShift = () => db.exec(`delete from waiter_shift_sessions`)
await openShift()

const issue = async (table = 7) => (await q('select * from issue_table_code($1)', [T[table] ?? table]))[0]
const redeem = async (code) => (await q('select * from redeem_table_code($1)', [code]))[0]
const lookup = async (token) => (await q('select * from table_session_lookup($1)', [token]))[0]
const submit = async (token, over = {}) =>
  (await q('select * from create_cart_submission($1,$2::jsonb,$3,$4)',
    [token, JSON.stringify(over.payload ?? { version: 1, items: [{ item_uid: 'x' }] }), over.items ?? 2, over.total ?? 5000]))[0]
const sha = async (s) => (await q(`select encode(extensions.digest($1,'sha256'),'hex') h`, [s]))[0].h

// ───────────────────────────────────────────────────────────────────────
section('issuing a code (the waiter)')
await as(ann.auth_user_id)
const i1 = await issue(7)
check('a waiter on shift gets six digits', /^\d{6}$/.test(i1.code), JSON.stringify(i1))
{
  const ms = new Date(i1.expires_at).getTime() - Date.now()
  check('…good for ~10 minutes to be typed for the FIRST time', ms > 8 * 60_000 && ms < 11 * 60_000, `${ms}`)
}
{
  const row = (await q('select * from waiter_table_codes where table_id = $1', [T[7]]))[0]
  check('only the SHA-256 hash is stored — never the digits', row.code_hash === (await sha(i1.code)) && row.code_hash.length === 64 && row.code_hash !== i1.code)
  check('…and the row is not yet activated', row.activated_at === null && row.visit_ends_at === null && row.consumed_at === null)
}
await as('')
check('signed-out cannot issue (42501)', (await threw('select * from issue_table_code($1)', [T[7]]))?.message?.includes('not staff') === true)
await as(gone.auth_user_id)
check('a removed person cannot issue', (await threw('select * from issue_table_code($1)', [T[7]]))?.message?.includes('not staff') === true)
await as(ann.auth_user_id)
await closeShift()
check('no open shift → no code (P0001)', (await threw('select * from issue_table_code($1)', [T[9]]))?.message?.includes('no active shift') === true)
await openShift()
check('an unknown table → refused', (await threw('select * from issue_table_code($1)', ['00000000-0000-0000-0000-000000000000']))?.message?.includes('unknown table') === true)
check('a DEACTIVATED table → refused', (await threw('select * from issue_table_code($1)', [T8]))?.message?.includes('unknown table') === true)

// ───────────────────────────────────────────────────────────────────────
section('redeeming — and recovering with the same digits')
await as('')
let r = await redeem('12345')
check('wrong shape → bad_code', r.ok === false && r.reason === 'bad_code')
r = await redeem('abcdef')
check('non-digits → bad_code', r.ok === false && r.reason === 'bad_code')
r = await redeem(null)
check('null → bad_code', r.ok === false && r.reason === 'bad_code')
const wrong = String((Number(i1.code) + 1) % 1000000).padStart(6, '0')
r = await redeem(wrong)
check('a wrong code → bad_code (and reveals nothing)', r.ok === false && r.reason === 'bad_code' && r.session_token === null)

const s1 = await redeem(i1.code)
check('the right digits → a session for table 7', s1.ok === true && /^[0-9a-f]{64}$/.test(s1.session_token) && s1.table_number === 7 && s1.table_id === T[7], JSON.stringify(s1))
const visitEnds = (await q('select visit_ends_at, activated_at from waiter_table_codes where table_id = $1', [T[7]]))[0]
check('…the first redemption ACTIVATES the visit (3 hours)', visitEnds.activated_at !== null &&
  Math.abs(new Date(visitEnds.visit_ends_at).getTime() - Date.now() - 3 * 3600_000) < 60_000)
check('…and the session ends exactly when the visit does', new Date(s1.expires_at).getTime() === new Date(visitEnds.visit_ends_at).getTime())
check('only the token\'s HASH is stored', (await q(`select count(*)::int c from customer_table_sessions where token_hash = $1`, [await sha(s1.session_token)]))[0].c === 1
  && (await q(`select count(*)::int c from customer_table_sessions where token_hash = $1`, [s1.session_token]))[0].c === 0)

// time passes: an hour into the visit
await db.exec(`update waiter_table_codes set activated_at = activated_at - interval '1 hour', visit_ends_at = visit_ends_at - interval '1 hour'`)
await db.exec(`update customer_table_sessions set expires_at = expires_at - interval '1 hour'`)
const endsBefore = new Date((await q('select visit_ends_at v from waiter_table_codes where table_id = $1', [T[7]]))[0].v).getTime()
const s2 = await redeem(i1.code)
check('RECOVERY: the SAME digits work again — a second device / cleared cookie', s2.ok === true && s2.session_token !== s1.session_token, JSON.stringify(s2))
check('…and recovery does NOT extend the visit (still the original end)', new Date(s2.expires_at).getTime() === endsBefore, `${s2.expires_at}`)
check('…both sessions are live', (await lookup(s1.session_token)).ok === true && (await lookup(s2.session_token)).ok === true)

// device cap
const tokens = [s1.session_token, s2.session_token]
for (let n = 0; n < 4; n++) tokens.push((await redeem(i1.code)).session_token)
check('six devices can be live at once', tokens.length === 6 && tokens.every(Boolean))
r = await redeem(i1.code)
check('the seventh is refused: too_many_devices', r.ok === false && r.reason === 'too_many_devices', JSON.stringify(r))
check('…and that does NOT burn the code (a signed-out device frees a slot)', await (async () => {
  await db.exec(`update customer_table_sessions set revoked_at = now() where token_hash = '${await sha(tokens[5])}'`)
  return (await redeem(i1.code)).ok === true
})())

// ───────────────────────────────────────────────────────────────────────
section('session lookup')
check('a live token resolves, with the table and the shift state', await (async () => {
  const l = await lookup(tokens[0]); return l.ok === true && l.table_number === 7 && l.shift_open === true
})())
check('a malformed token → no_session', (await lookup('nope')).reason === 'no_session' && (await lookup(null)).reason === 'no_session')
check('an unknown (well-formed) token → no_session', (await lookup('0'.repeat(64))).reason === 'no_session')
check('shift_open follows the shift', await (async () => { await closeShift(); const o = (await lookup(tokens[0])).shift_open; await openShift(); return o === false })())

// ───────────────────────────────────────────────────────────────────────
section('rotate (same party, new digits) and end (the party left)')
await as(cy.auth_user_id)
check('a bartender may rotate (any staff on an open shift may, like issuing)', (await threw('select * from waiter_rotate_table_code($1)', [T[7]])) === null)
await as(ann.auth_user_id)
const rot = (await q('select * from waiter_rotate_table_code($1)', [T[7]]))[0]
check('rotating returns NEW six digits', /^\d{6}$/.test(rot.code) && rot.code !== i1.code, JSON.stringify(rot))
check('…the visit\'s end is unchanged (activated visit keeps its fixed end)', new Date(rot.expires_at).getTime() === endsBefore)
r = await redeem(i1.code)
check('the OLD digits stop working', r.ok === false && r.reason === 'bad_code')
check('every connected device STAYS connected through a rotation', (await lookup(tokens[0])).ok === true && (await lookup(tokens[1])).ok === true)
check('the NEW digits recover the same visit', await (async () => {
  await db.exec(`update customer_table_sessions set revoked_at = now() where code_id = (select id from waiter_table_codes where table_id = '${T[7]}' and consumed_at is null) and token_hash = '${await sha(tokens[4])}'`)
  const n = await redeem(rot.code); return n.ok === true })())
check('rotating a table with no visit → P0004', (await threw('select * from waiter_rotate_table_code($1)', [T[9]]))?.message?.includes('no visit') === true)

const live7 = (await q('select count(*)::int c from waiter_table_codes where table_id = $1 and consumed_at is null', [T[7]]))[0].c
check('exactly ONE live visit per table', live7 === 1)

// a NEW party replaces the visit
const subBeforeEnd = await submit(tokens[0])
check('(setup) a device submits an order', subBeforeEnd.ok === true, JSON.stringify(subBeforeEnd))
check('rotating the digits for the SAME party expires nothing — their request is still pending',
  (await q(`select status from customer_cart_submissions where id = $1`, [subBeforeEnd.submission_id]))[0].status === 'pending')
const i2 = await issue(7)
check('issuing again starts a NEW visit', /^\d{6}$/.test(i2.code))
check('…the old party\'s devices are signed out of the table', (await lookup(tokens[0])).ok === false && (await lookup(tokens[1])).ok === false)
r = await redeem(rot.code)
check('…and their digits are dead', r.ok === false && r.reason === 'bad_code')
check('…and their UNREVIEWED request is EXPIRED — it can never be imported onto the next party\'s bill',
  (await q(`select status from customer_cart_submissions where id = $1`, [subBeforeEnd.submission_id]))[0].status === 'expired')
check('…so it no longer appears in staff\'s queue', await (async () => {
  const keep = ann.auth_user_id; await as(keep)
  return !(await q('select * from waiter_pending_submissions()')).some((r) => r.id === subBeforeEnd.submission_id) })())
const live7b = (await q('select count(*)::int c, max(ended_reason) er from waiter_table_codes where table_id = $1 and consumed_at is null', [T[7]]))[0]
check('…still exactly one live visit; the old one is marked "replaced"', live7b.c === 1 &&
  (await q(`select count(*)::int c from waiter_table_codes where table_id = $1 and ended_reason = 'replaced'`, [T[7]]))[0].c >= 1)

const sA = await redeem(i2.code)
check('(setup) the new party connects', sA.ok === true)
// a request from the NEW party, and one from a DIFFERENT table's party that must be left alone
const subNew = await submit(sA.session_token)
const other9 = await issue(9); const sOther = await redeem(other9.code)
const subOther = await submit(sOther.session_token)
check('(setup) two requests: the new party at table 7, and a party at table 9', subNew.ok === true && subOther.ok === true)
check('staff end the visit → every device is signed out', await (async () => {
  const e = (await q('select waiter_end_table_visit($1, $2) r', [T[7], 'table_closed']))[0].r
  return e === true && (await lookup(sA.session_token)).ok === false && (await redeem(i2.code)).ok === false })())
check('…the reason is recorded', (await q(`select count(*)::int c from waiter_table_codes where table_id = $1 and ended_reason = 'table_closed'`, [T[7]]))[0].c === 1)
check('…ending expired THAT party\'s unreviewed request', (await q(`select status from customer_cart_submissions where id = $1`, [subNew.submission_id]))[0].status === 'expired')
check('…and left the OTHER table\'s party alone (still pending, still connected)',
  (await q(`select status from customer_cart_submissions where id = $1`, [subOther.submission_id]))[0].status === 'pending' && (await lookup(sOther.session_token)).ok === true)
check('a request a waiter already took stays "imported" — ending a visit never rewrites history', await (async () => {
  const c = await issue(10); const d = await redeem(c.code); const s = await submit(d.session_token)
  const ord = (await q('insert into waiter_orders default values returning id'))[0].id
  await q('select waiter_review_submission($1,$2,$3)', [s.submission_id, 'imported', ord])
  await q('select waiter_end_table_visit($1)', [T[10]])
  return (await q(`select status from customer_cart_submissions where id = $1`, [s.submission_id]))[0].status === 'imported' })())
await closeShift()
check('ending needs no open shift (tidying up must stay possible)', (await threw('select waiter_end_table_visit($1)', [T[7]])) === null)
await openShift()
await as('')
check('signed-out cannot end a visit', (await threw('select waiter_end_table_visit($1)', [T[7]]))?.message?.includes('not staff') === true)
await as(ann.auth_user_id)
check('an unknown reason falls back to "staff" (the CHECK is never tripped)', await (async () => {
  const x = await issue(10); await q('select waiter_end_table_visit($1, $2)', [T[10], 'banana'])
  return (await q(`select ended_reason er from waiter_table_codes where table_id = $1 order by issued_at desc limit 1`, [T[10]]))[0].er === 'staff' })())

// ───────────────────────────────────────────────────────────────────────
section('running out of time')
await as(ann.auth_user_id)
const i3 = await issue(9)
await db.exec(`update waiter_table_codes set expires_at = now() - interval '1 minute' where table_id = '${T[9]}' and consumed_at is null`)
r = await redeem(i3.code)
check('a code nobody typed within 10 minutes → expired', r.ok === false && r.reason === 'expired', JSON.stringify(r))
check('…and it is closed, not left lying around', (await q(`select consumed_at is not null c, ended_reason er from waiter_table_codes where table_id = $1 order by issued_at desc limit 1`, [T[9]]))[0].er === 'expired')

const i4 = await issue(9)
const sB = await redeem(i4.code)
await db.exec(`update waiter_table_codes set visit_ends_at = now() - interval '1 minute' where table_id = '${T[9]}' and consumed_at is null`)
check('an activated visit past its three hours: the existing session is no longer valid', (await lookup(sB.session_token)).ok === false)
r = await redeem(i4.code)
check('…and typing the digits again → expired, with every device signed out', r.ok === false && r.reason === 'expired' &&
  (await q(`select count(*)::int c from customer_table_sessions where code_id = (select id from waiter_table_codes where table_id = '${T[9]}' order by issued_at desc limit 1) and revoked_at is null`))[0].c === 0)

// ───────────────────────────────────────────────────────────────────────
section('digits are unique among live visits')
{
  const seen = new Set()
  await db.exec(`delete from customer_cart_submissions; delete from customer_table_sessions; delete from waiter_table_codes`)
  let tables = []
  for (let n = 100; n < 160; n++) tables.push((await q(`insert into waiter_tables(number) values ($1) returning id`, [n]))[0].id)
  await as(ann.auth_user_id)
  for (const id of tables) { const c = await q('select * from issue_table_code($1)', [id]); seen.add(c[0].code) }
  check('60 tables at once → 60 different codes', seen.size === 60)
  const hashes = (await q('select count(distinct code_hash)::int c from waiter_table_codes where consumed_at is null'))[0].c
  check('…and 60 different live hashes', hashes === 60)
}

// ───────────────────────────────────────────────────────────────────────
section('sending a cart — a REQUEST, capped')
await db.exec(`delete from customer_cart_submissions; delete from customer_table_sessions; delete from waiter_table_codes`)
await as(ann.auth_user_id)
const c11 = await issue(11)
const dA = await redeem(c11.code)
const dB = await redeem(c11.code)       // a second phone at the same table
let sub = await submit(dA.session_token)
check('a live session sends a cart → a PENDING request', sub.ok === true && sub.table_number === 11 && !!sub.submission_id, JSON.stringify(sub))
{
  const row = (await q('select * from customer_cart_submissions where id = $1', [sub.submission_id]))[0]
  check('…stored as pending, with the counts and the table snapshot, never as an order', row.status === 'pending' && row.item_count === 2 && row.total_agorot === 5000 && row.table_number === 11 && row.order_id === null && row.reviewed_by === null)
}
sub = await submit(dB.session_token)
check('a second send within 20 seconds (even from the OTHER phone) → too_fast', sub.ok === false && sub.reason === 'too_fast', JSON.stringify(sub))
await db.exec(`update customer_cart_submissions set created_at = created_at - interval '30 seconds'`)
sub = await submit(dB.session_token)
check('…after the gap it goes through', sub.ok === true)
await db.exec(`update customer_cart_submissions set created_at = created_at - interval '30 seconds'`)
sub = await submit(dA.session_token)
check('the third pending is accepted', sub.ok === true)
await db.exec(`update customer_cart_submissions set created_at = created_at - interval '30 seconds'`)
sub = await submit(dA.session_token)
check('a FOURTH pending is refused: too_many_pending (staff have not looked yet)', sub.ok === false && sub.reason === 'too_many_pending', JSON.stringify(sub))

check('no live session → no_session', (await submit('0'.repeat(64))).reason === 'no_session' && (await submit('junk')).reason === 'no_session')
await closeShift()
check('no open shift → no_shift', (await submit(dA.session_token)).reason === 'no_shift')
await openShift()

// payload sanity (use a fresh visit so the caps are not in the way)
await as(ann.auth_user_id)
const c9 = await issue(9); const dC = await redeem(c9.code)
for (const [name, over] of [
  ['an array payload', { payload: [1, 2] }],
  ['zero items', { items: 0 }],
  ['61 items (MAX_LINES is 60)', { items: 61 }],
  ['a negative total', { total: -1 }],
  ['an absurd total', { total: 100000001 }],
  ['an oversize (>64 KB) payload', { payload: { blob: 'x'.repeat(70000) } }],
]) {
  const res = await submit(dC.session_token, over)
  check(`${name} → bad_request`, res.ok === false && res.reason === 'bad_request', JSON.stringify(res))
}
check('nothing was stored for the refused ones', (await q(`select count(*)::int c from customer_cart_submissions where table_number = 9`))[0].c === 0)
check('a null payload / null counts → bad_request', (await q('select * from create_cart_submission($1, null, 1, 1)', [dC.session_token]))[0].reason === 'bad_request'
  && (await q(`select * from create_cart_submission($1, '{}'::jsonb, null, 1)`, [dC.session_token]))[0].reason === 'bad_request')

// ───────────────────────────────────────────────────────────────────────
section('what the customer sees after recovering')
{
  const mine = await q('select * from table_session_submissions($1)', [dB.session_token])
  check('ANY device of the visit sees every request the visit sent (3), newest first', mine.length === 3 &&
    new Date(mine[0].created_at) >= new Date(mine[2].created_at))
  check('…with status and counts, and no payload', 'status' in mine[0] && 'item_count' in mine[0] && !('payload' in mine[0]))
  const other = await q('select * from table_session_submissions($1)', [dC.session_token])
  check('another table\'s visit sees none of them', other.length === 0)
  check('a bad token sees nothing (not an error)', (await q('select * from table_session_submissions($1)', ['0'.repeat(64)])).length === 0 && (await q('select * from table_session_submissions(null)')).length === 0)
}

// ───────────────────────────────────────────────────────────────────────
section('staff: the queue, and first tap wins')
await as(ann.auth_user_id)
let pend = await q('select * from waiter_pending_submissions()')
check('a waiter on shift sees the 3 pending requests, oldest first, WITH the payload', pend.length === 3 && !!pend[0].payload && pend[0].table_number === 11 &&
  new Date(pend[0].created_at) <= new Date(pend[2].created_at))
await as(cy.auth_user_id)
check('a bartender sees NOTHING (empty, not an error)', (await q('select * from waiter_pending_submissions()')).length === 0)
await as('')
check('signed-out sees nothing', (await q('select * from waiter_pending_submissions()')).length === 0)
await as(gone.auth_user_id)
check('a removed person sees nothing', (await q('select * from waiter_pending_submissions()')).length === 0)

const sid = pend[0].id
const order = (await q('insert into waiter_orders default values returning id'))[0].id
await as(cy.auth_user_id)
check('a non-recipient cannot review → forbidden', (await q('select waiter_review_submission($1, $2, $3) r', [sid, 'imported', order]))[0].r === 'forbidden')
await as(ann.auth_user_id)
check('a bad outcome is refused, not applied', (await q('select waiter_review_submission($1, $2) r', [sid, 'approved']))[0].r === 'bad_outcome')
check('a recipient imports → ok', (await q('select waiter_review_submission($1, $2, $3) r', [sid, 'imported', order]))[0].r === 'ok')
{
  const row = (await q('select * from customer_cart_submissions where id = $1', [sid]))[0]
  check('…recording WHO, WHEN and WHICH ORDER it went onto', row.status === 'imported' && row.reviewed_by === ann.id && row.reviewed_at !== null && row.order_id === order)
}
await as(ben.auth_user_id)
check('a second waiter taps the same one → taken (first tap wins)', (await q('select waiter_review_submission($1, $2, $3) r', [sid, 'imported', order]))[0].r === 'taken')
check('an unknown id → missing', (await q('select waiter_review_submission($1, $2) r', ['00000000-0000-0000-0000-000000000000', 'rejected']))[0].r === 'missing')
check('rejecting records no order', await (async () => {
  const id2 = pend[1].id
  const x = (await q('select waiter_review_submission($1, $2, $3) r', [id2, 'rejected', order]))[0].r
  return x === 'ok' && (await q('select order_id from customer_cart_submissions where id = $1', [id2]))[0].order_id === null })())
pend = await q('select * from waiter_pending_submissions()')
check('reviewed requests leave the queue for everyone', pend.length === 1 && pend[0].id !== sid)
await db.exec(`update customer_cart_submissions set created_at = now() - interval '3 hours' where status = 'pending'`)
check('requests older than 2 hours are not offered', (await q('select * from waiter_pending_submissions()')).length === 0)

// ───────────────────────────────────────────────────────────────────────
section('what the table\'s "remote order" sheet reads')
await as(ann.auth_user_id)
const c10 = await issue(10)
let v = (await q('select waiter_table_visit($1) j', [T[10]]))[0].j
check('a fresh visit: has_visit, not activated, 0 devices, shift open', v.has_visit === true && v.activated === false && v.devices === 0 && v.shift_open === true, JSON.stringify(v))
await redeem(c10.code); await redeem(c10.code)
v = (await q('select waiter_table_visit($1) j', [T[10]]))[0].j
check('after two phones connect: activated, 2 devices', v.activated === true && v.devices === 2)
check('…it NEVER carries the digits (only a hash exists)', !JSON.stringify(v).includes(c10.code) && !('code' in v))
v = (await q('select waiter_table_visit($1) j', [T[7]]))[0].j
check('a table with no visit: has_visit false, ends_at null', v.has_visit === false && v.ends_at === null)
await as('')
check('signed-out gets null', (await q('select waiter_table_visit($1) j', [T[10]]))[0].j === null)

// ───────────────────────────────────────────────────────────────────────
section('who is told — 057\'s rule, factored out of its signed-in wrapper')
const ids = async () => (await q('select * from waiter_call_recipient_staff_ids() id')).map((x) => x.id).sort()
const want = (...p) => p.map((x) => x.id).sort()
check('shift open, no schedule in use: waiter, shift manager, dev — not the bartender, not the removed person',
  JSON.stringify(await ids()) === JSON.stringify(want(ann, ben, dev)), JSON.stringify(await ids()))
await closeShift()
check('no open shift → nobody', (await ids()).length === 0)
await openShift()
const today = (await q(`select to_char((now() at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') d`))[0].d
const hh = async (m) => (await q(`select to_char((now() at time zone 'Asia/Jerusalem') + ($1::int * interval '1 minute'), 'HH24:MI') h`, [m]))[0].h
for (const shape of ['nested', 'flat']) {
  const snap = (shifts) => JSON.stringify(shape === 'nested' ? { shifts } : {
    shifts: shifts.map((s, i) => ({ id: `s${i}`, shift_date: s.date, start_time: s.start, end_time: s.end })),
    assignments: shifts.flatMap((s, i) => s.assignments.map((a) => ({ shift_id: `s${i}`, staff_id: a.staffId }))),
  })
  await db.exec('delete from schedule_weeks')
  await q(`insert into schedule_weeks(week_start, status, published_snapshot) values ($1,'published',$2::jsonb)`,
    [today, snap([{ date: today, start: await hh(-60), end: await hh(120), assignments: [{ staffId: ann.id }] }])])
  check(`[${shape}] schedule in use, only Ann assigned and inside → only Ann`, JSON.stringify(await ids()) === JSON.stringify(want(ann)), JSON.stringify(await ids()))
  await db.exec('delete from schedule_weeks')
  await q(`insert into schedule_weeks(week_start, status, published_snapshot) values ($1,'published',$2::jsonb)`,
    [today, snap([{ date: today, start: await hh(-300), end: await hh(-45), assignments: [{ staffId: ann.id }] }])])
  check(`[${shape}] her shift ended 45 minutes ago → nobody (30-minute grace is over)`, (await ids()).length === 0)
}
await db.exec('delete from schedule_weeks')
await as(ann.auth_user_id)
check('waiter_is_call_recipient() (the signed-in wrapper) still agrees', (await q('select waiter_is_call_recipient() r'))[0].r === true)
await as(cy.auth_user_id)
check('…and still refuses the bartender', (await q('select waiter_is_call_recipient() r'))[0].r === false)

// ───────────────────────────────────────────────────────────────────────
section('push: the POS registers as the signed-in person')
await db.exec(`insert into staff_push_subscriptions(staff_id, endpoint, p256dh, auth) values ('${ann.id}', 'https://push.example/portal-device', '${'p'.repeat(20)}', '${'a'.repeat(12)}')`)
check('a pre-058 (portal) subscription becomes app = "portal" by default', (await q(`select app from staff_push_subscriptions where endpoint = 'https://push.example/portal-device'`))[0].app === 'portal')
const reg = (ep, p = 'P'.repeat(20), a = 'A'.repeat(12), ua = 'Mozilla') => q('select waiter_register_push($1,$2,$3,$4) r', [ep, p, a, ua])
await as(ann.auth_user_id)
check('a signed-in waiter registers the POS device', (await reg('https://push.example/pos-ann'))[0].r === true)
check('…stored as app = "oms", for HER, fresh', await (async () => {
  const x = (await q(`select * from staff_push_subscriptions where endpoint = 'https://push.example/pos-ann'`))[0]
  return x.app === 'oms' && x.staff_id === ann.id && Date.now() - new Date(x.last_seen_at).getTime() < 60_000 })())
check('the portal subscription is untouched', (await q(`select app, staff_id from staff_push_subscriptions where endpoint = 'https://push.example/portal-device'`))[0].app === 'portal')
await db.exec(`update staff_push_subscriptions set last_seen_at = now() - interval '2 days' where endpoint = 'https://push.example/pos-ann'`)
await reg('https://push.example/pos-ann')
check('registering again refreshes last_seen_at (this is how "logged in on the POS" is kept fresh)', Date.now() - new Date((await q(`select last_seen_at from staff_push_subscriptions where endpoint = 'https://push.example/pos-ann'`))[0].last_seen_at).getTime() < 60_000)
await as(ben.auth_user_id)
await reg('https://push.example/pos-ann')
check('a shared tablet: the same endpoint MOVES to whoever is signed in now (one row, not two)', await (async () => {
  const rows = await q(`select staff_id from staff_push_subscriptions where endpoint = 'https://push.example/pos-ann'`)
  return rows.length === 1 && rows[0].staff_id === ben.id })())
await as(ann.auth_user_id)
check('Ann cannot unregister Ben\'s device', (await q('select waiter_unregister_push($1) r', ['https://push.example/pos-ann']))[0].r === true &&
  (await q(`select count(*)::int c from staff_push_subscriptions where endpoint = 'https://push.example/pos-ann'`))[0].c === 1)
await as(ben.auth_user_id)
await q('select waiter_unregister_push($1)', ['https://push.example/pos-ann'])
check('Ben can unregister his own', (await q(`select count(*)::int c from staff_push_subscriptions where endpoint = 'https://push.example/pos-ann'`))[0].c === 0)
await as(ann.auth_user_id)
await q('select waiter_unregister_push($1)', ['https://push.example/portal-device'])
check('unregister never removes a PORTAL subscription (the portal route owns those)', (await q(`select count(*)::int c from staff_push_subscriptions where endpoint = 'https://push.example/portal-device'`))[0].c === 1)
for (const [name, args] of [
  ['an http:// endpoint', ['http://push.example/x']],
  ['a too-long endpoint', ['https://push.example/' + 'x'.repeat(1000)]],
  ['a too-short p256dh', ['https://push.example/ok', 'short']],
  ['a too-short auth', ['https://push.example/ok', 'P'.repeat(20), 'x']],
  ['a null endpoint', [null]],
]) check(`${name} → refused`, (await reg(...args))[0].r === false)
await as('')
check('signed-out cannot register', (await reg('https://push.example/anon'))[0].r === false)
await as(gone.auth_user_id)
check('a removed person cannot register', (await reg('https://push.example/gone'))[0].r === false)

// ───────────────────────────────────────────────────────────────────────
section('housekeeping')
await db.exec(`delete from customer_cart_submissions; delete from customer_table_sessions; delete from waiter_table_codes`)
await as(ann.auth_user_id)
const k1 = await issue(7); const kS = await redeem(k1.code)            // a LIVE activated visit
await db.exec(`update waiter_table_codes set expires_at = now() - interval '2 days'`)  // its first-use deadline is long past
const k2 = await issue(9)                                               // a visit that ended 3 days ago
await db.exec(`update waiter_table_codes set consumed_at = now() - interval '3 days', expires_at = now() - interval '3 days' where table_id = '${T[9]}'`)
await db.exec('select cleanup_table_codes()')
check('cleanup keeps a live visit even though its first-use deadline passed days ago (048 would have deleted it)',
  (await q(`select count(*)::int c from waiter_table_codes where table_id = $1`, [T[7]]))[0].c === 1)
check('…and deletes one that ended three days ago', (await q(`select count(*)::int c from waiter_table_codes where table_id = $1`, [T[9]]))[0].c === 0)

// ───────────────────────────────────────────────────────────────────────
section('privileges — the customer-side functions go to NOBODY but service_role')
const priv = async (fn, role) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p
for (const [fn, expect] of [
  ['public.redeem_table_code(text)',                              { authenticated: false, anon: false }],
  ['public.table_session_lookup(text)',                           { authenticated: false, anon: false }],
  ['public.table_session_submissions(text)',                      { authenticated: false, anon: false }],
  ['public.create_cart_submission(text,jsonb,integer,integer)',   { authenticated: false, anon: false }],
  ['public.waiter_staff_is_call_recipient(uuid)',                 { authenticated: false, anon: false }],
  ['public.waiter_call_recipient_staff_ids()',                    { authenticated: false, anon: false }],
  ['public._table_code_is_live(public.waiter_table_codes)',       { authenticated: false, anon: false }],
  ['public._mint_table_digits()',                                 { authenticated: false, anon: false }],
  ['public._end_table_visit(uuid,text)',                          { authenticated: false, anon: false }],
  ['public.cleanup_table_codes()',                                { authenticated: false, anon: false }],
  ['public.issue_table_code(uuid)',                               { authenticated: true,  anon: false }],
  ['public.waiter_rotate_table_code(uuid)',                       { authenticated: true,  anon: false }],
  ['public.waiter_end_table_visit(uuid,text)',                    { authenticated: true,  anon: false }],
  ['public.waiter_table_visit(uuid)',                             { authenticated: true,  anon: false }],
  ['public.waiter_pending_submissions()',                         { authenticated: true,  anon: false }],
  ['public.waiter_review_submission(uuid,text,uuid)',             { authenticated: true,  anon: false }],
  ['public.waiter_register_push(text,text,text,text)',            { authenticated: true,  anon: false }],
  ['public.waiter_unregister_push(text)',                         { authenticated: true,  anon: false }],
  ['public.waiter_is_call_recipient()',                           { authenticated: true,  anon: false }],
]) for (const [role, want2] of Object.entries(expect)) check(`${fn} execute for ${role} = ${want2}`, (await priv(fn, role)) === want2)
check('RLS is still on, with no policies, on the three order tables', (await q(`select count(*)::int c from pg_class where relname in ('waiter_table_codes','customer_table_sessions','customer_cart_submissions') and relrowsecurity`))[0].c === 3
  && (await q(`select count(*)::int c from pg_policies where tablename in ('waiter_table_codes','customer_table_sessions','customer_cart_submissions')`))[0].c === 0)
// NOT asserted here, deliberately: table-level grants. This stub has no Supabase
// default privileges, so such a check would pass vacuously. After applying, verify on
// production: RLS on + zero policies on the three tables, and has_function_privilege.

console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1) }
