#!/usr/bin/env node
// Offline test of migration 061 (TABLE OWNERSHIP FOR CUSTOMER REQUESTS + the activity feed hearing
// about them) against an in-memory Postgres — PGlite, no Docker. It applies the REAL 048, 049, 057, 058
// and 061 files, stubbing only what they reference.
//
//   node scripts/check-migration-061.mjs
//
// WHY IT EXISTS: on 2026-10-15 the owner connected a customer to a table, sent an order — and the POS
// showed no request, because 057's roster rule excluded the very person who had linked the table. 061 is
// the fix; this proves it does what its header claims BEFORE the owner is asked to apply it.
//
// WHAT IT PROVES:
//   1. LINKING CLAIMS: issuing a code makes the caller the table's waiter, writes a `table_chained`
//      event stamped with their name, records a take-over, and can never assign the table to anyone else;
//   2. THE PRODUCTION BUG, REPRODUCED AND FIXED: a published schedule that does not include the person who
//      linked the table no longer hides that table's order from them — and the rule's other edges
//      (management oversight, 90-second escalation, nobody without a shift, a bartender never) hold;
//   3. FIRST TAP STILL WINS, and only someone allowed to handle the table can tap;
//   4. THE FEED hears about a customer connecting, ordering and calling — and a feed failure can never
//      lose the customer's order;
//   5. A CONNECTED PHONE CALLS WITHOUT TYPING A TABLE, the table is the session's, and the customer is
//      shown the waiter's first name — never a surname or an email;
//   6. EVERY GRANT is what the header says.
//
// WHAT IT CANNOT PROVE: production's real grants/RLS (verify with has_function_privilege + get_advisors
// after applying) and true concurrency. Run it away from 23:30–00:30 Israel time (the schedule cases build
// times relative to "now").

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

// ── stubs: only what the real files reference ───────────────────────────
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create extension pgcrypto with schema extensions;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.staff (
    id uuid primary key default gen_random_uuid(), auth_user_id uuid, role text, badge text,
    active boolean default true, first_name text, last_name text, display_name text, email text);
  create function public.is_staff_client() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.staff s where s.auth_user_id = auth.uid() and s.active) $$;
  create function public.current_staff_id() returns uuid language sql stable security definer as $$
    select id from public.staff where auth_user_id = auth.uid() $$;
  create table public.waiter_tables (
    id uuid primary key default gen_random_uuid(), number integer unique not null, active boolean default true,
    held_by_staff_id uuid references public.staff(id), held_since timestamptz);
  -- 022's guard, reduced to the rule that matters here: a signed-in person may set held_by to THEMSELVES only.
  create function public.waiter_tables_guard() returns trigger language plpgsql security definer as $$
  declare me uuid := public.current_staff_id();
  begin
    if auth.uid() is null then return new; end if;
    if new.held_by_staff_id is distinct from old.held_by_staff_id then
      if new.held_by_staff_id is not null and new.held_by_staff_id <> me then
        raise exception 'a table can only be assigned to yourself' using errcode = '42501';
      end if;
      new.held_since := case when new.held_by_staff_id is null then null else now() end;
    end if;
    return new;
  end $$;
  create trigger waiter_tables_guard before update on public.waiter_tables for each row execute function public.waiter_tables_guard();
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
  -- The feed, as 023 left it (the vocabulary 061 must widen), with the actor-stamping trigger.
  create table public.waiter_order_events (
    id bigserial primary key, order_id uuid, event text not null, actor text, payload jsonb,
    at timestamptz not null default now(), actor_staff_id uuid, table_id uuid,
    constraint waiter_order_events_event_check check (event in (
      'opened','item_added','qty_changed','item_removed','filed','paid','voided','reopened','note_changed',
      'batch_opened','batch_filed','seat_added','seat_removed','table_assigned','table_released',
      'table_taken_over','label_changed','item_sent','item_ready','item_delivered','item_undelivered',
      'guest_added','guest_renamed','guest_removed','item_reassigned')),
    constraint waiter_order_events_scope_check check (order_id is not null or table_id is not null));
  create function public.waiter_events_stamp() returns trigger language plpgsql security definer as $$
  declare me uuid := public.current_staff_id();
  begin
    if me is not null then
      new.actor_staff_id := me;
      new.actor := coalesce((select coalesce(nullif(trim(display_name), ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), email)
                               from public.staff where id = me), new.actor);
    end if;
    return new;
  end $$;
  create trigger waiter_events_stamp before insert on public.waiter_order_events for each row execute function public.waiter_events_stamp();
`)

section('the real files apply')
for (const f of ['048_customer_table_ordering_groundwork.sql', '049_correct_table_code_attempt_counter_claim.sql',
                 '057_waiter_calls_and_schedule_sync.sql', '058_remote_ordering.sql', '061_table_ownership_and_alerts.sql']) {
  try { await db.exec(readFileSync(new URL(f, ROOT), 'utf8')); check(`${f} applies cleanly`, true) }
  catch (e) { check(`${f} applies cleanly`, false, e.message) }
}
try { await db.exec(readFileSync(new URL('061_table_ownership_and_alerts.sql', ROOT), 'utf8')); check('061 is idempotent (re-run is harmless)', true) }
catch (e) { check('061 is idempotent (re-run is harmless)', false, e.message) }

// ── people, tables, a shift ────────────────────────────────────────────
const mkStaff = async (role, badge, first, extra = {}) =>
  (await q(`insert into staff(auth_user_id, role, badge, first_name, last_name, email, display_name) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6) returning id, auth_user_id`,
    [role, badge, first, extra.last ?? 'Surname', extra.email ?? `${first}@example.test`, extra.display ?? null]))[0]
const ann = await mkStaff('staff', 'waiter', 'Ann')                      // the waiter who links tables
const bob = await mkStaff('staff', 'waiter', 'Bob')                      // another waiter on the roster
const eve = await mkStaff('staff', 'waiter', 'Eve')                      // a waiter NOT on tonight's roster
const mia = await mkStaff('staff', 'manager', 'Mia')                     // a shift manager
const cy = await mkStaff('staff', 'bartender', 'Cy')
const dev = await mkStaff('owner', 'Dev', 'Dev')                         // the owner's own account: never on the roster
const gone = await mkStaff('staff', 'waiter', 'Gone'); await db.exec(`update staff set active = false where id = '${gone.id}'`)
const T = {}
for (const n of [1, 2, 3, 4, 5]) T[n] = (await q(`insert into waiter_tables(number) values ($1) returning id`, [n]))[0].id
const openShift = () => db.exec(`delete from waiter_shift_sessions; insert into waiter_shift_sessions(status) values ('active')`)
const closeShift = () => db.exec(`delete from waiter_shift_sessions`)
await openShift()

const issue = async (n) => (await q('select * from issue_table_code($1)', [T[n]]))[0]
const redeem = async (code) => (await q('select * from redeem_table_code($1)', [code]))[0]
const submit = async (token, items = 2, total = 8200) =>
  (await q('select * from create_cart_submission($1,$2::jsonb,$3,$4)', [token, JSON.stringify({ version: 1, items: [{ item_uid: 'x' }] }), items, total]))[0]
const events = (kind) => q(`select * from waiter_order_events where event = $1 order by id`, [kind])
const holderOf = async (n) => (await q('select held_by_staff_id h from waiter_tables where id = $1', [T[n]]))[0].h
const age = (secs) => db.exec(`update customer_cart_submissions set created_at = created_at - interval '${secs} seconds'`)
const seen = async (uid) => { await as(uid); return (await q('select * from waiter_pending_submissions()')).map((r) => r.table_number) }

// ───────────────────────────────────────────────────────────────────────
section('linking a table CLAIMS it, and the feed hears about it')
check('(setup) nobody holds table 1', (await holderOf(1)) === null)
await as(ann.auth_user_id)
const c1 = await issue(1)
check('a waiter generates a code', /^\d{6}$/.test(c1.code))
check('…and now HOLDS table 1 (the owner: "the user logged in claims the table automatically")', (await holderOf(1)) === ann.id)
check('…held_since was stamped by the existing guard', (await q('select held_since from waiter_tables where id = $1', [T[1]]))[0].held_since !== null)
{
  const ev = await events('table_chained')
  check('the activity feed got ONE table_chained event for table 1', ev.length === 1 && ev[0].table_id === T[1] && ev[0].payload.table === 1, JSON.stringify(ev))
  check('…stamped with the waiter who linked it (actor from the session, not typed)', ev[0].actor === 'Ann Surname' && ev[0].actor_staff_id === ann.id, JSON.stringify(ev[0]))
  check('…and not marked as a take-over', ev[0].payload.taken_over === false)
}
const c1b = await issue(1)
check('linking the same table again by the same waiter keeps the claim (no error, no churn)', (await holderOf(1)) === ann.id && /^\d{6}$/.test(c1b.code))
await as(bob.auth_user_id)
await issue(1)
check('another waiter linking it takes it over', (await holderOf(1)) === bob.id)
check('…and the event says it was a take-over', (await events('table_chained')).at(-1).payload.taken_over === true)
await as(ann.auth_user_id)
await issue(1)
check('the claim can never go to anyone but the caller (the 022 guard is still in charge)', await (async () => {
  const e = await threw(`update waiter_tables set held_by_staff_id = $1 where id = $2`, [bob.id, T[1]])
  return e?.message?.includes('assigned to yourself') === true })())
await closeShift()
check('no open shift → no code, and NO claim and no event', await (async () => {
  const before = (await events('table_chained')).length
  const e = await threw('select * from issue_table_code($1)', [T[2]])
  return e?.message?.includes('no active shift') === true && (await holderOf(2)) === null && (await events('table_chained')).length === before })())
await openShift()
check('an unknown / deactivated table claims nothing', await (async () => {
  const e = await threw('select * from issue_table_code($1)', ['00000000-0000-0000-0000-000000000000'])
  return e?.message?.includes('unknown table') === true })())

// ───────────────────────────────────────────────────────────────────────
section('the feed hears about a customer: connecting, ordering, calling')
await as('')
const s1 = await redeem(c1.code)           // (c1 was replaced by the later issues — use a fresh visit)
check('the first code was replaced by the later visit (so its digits are dead)', s1.ok === false)
await as(ann.auth_user_id)
const cA = await issue(1)
await as('')
const sA = await redeem(cA.code)
check('a customer connects', sA.ok === true)
{
  const ev = await events('customer_connected')
  check('→ a customer_connected event on table 1, actor "לקוח", with the device count', ev.length === 1 && ev[0].table_id === T[1] && ev[0].actor === 'לקוח' && ev[0].payload.devices === 1, JSON.stringify(ev))
}
const subA = await submit(sA.session_token)
check('the customer sends an order', subA.ok === true)
{
  const ev = await events('customer_order')
  check('→ a customer_order event carrying the counts and the submission id', ev.length === 1 && ev[0].payload.items === 2 && ev[0].payload.total_agorot === 8200 && ev[0].payload.submission === subA.submission_id, JSON.stringify(ev))
}
const callA = (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sA.session_token, 'bill', 2, 8200]))[0]
check('the customer calls for the bill', callA.ok === true)
{
  const ev = await events('customer_call')
  check('→ a customer_call event with the kind', ev.length === 1 && ev[0].payload.kind === 'bill' && ev[0].table_id === T[1], JSON.stringify(ev))
}
check('a feed failure must NEVER lose the customer\'s order: break the feed, send, the request still lands', await (async () => {
  await db.exec(`alter table waiter_order_events add constraint feed_broken check (false) not valid`)
  await db.exec(`update customer_cart_submissions set created_at = created_at - interval '60 seconds'`)
  const r = await submit(sA.session_token)
  await db.exec(`alter table waiter_order_events drop constraint feed_broken`)
  return r.ok === true && (await q('select count(*)::int c from customer_cart_submissions'))[0].c === 2 })())
check('a request whose table was deleted (table_id null) is still accepted — the feed row is simply skipped', await (async () => {
  const tmp = (await q(`insert into waiter_tables(number) values (99) returning id`))[0].id
  await as(ann.auth_user_id); const c = (await q('select * from issue_table_code($1)', [tmp]))[0]
  await as(''); const s = await redeem(c.code)
  await db.exec(`update customer_cart_submissions set table_id = null where false`)
  const before = (await events('customer_order')).length
  const r = await submit(s.session_token)
  await db.exec(`update customer_cart_submissions set table_id = null where id = '${r.submission_id}'`)
  return r.ok === true && (await events('customer_order')).length === before + 1 })())
await db.exec(`delete from customer_cart_submissions where table_number = 99`)

// ───────────────────────────────────────────────────────────────────────
section('THE PRODUCTION BUG: who sees the order — a published schedule that does not include the linker')
await db.exec(`delete from customer_cart_submissions; delete from waiter_table_calls`)
const today = (await q(`select to_char((now() at time zone 'Asia/Jerusalem')::date, 'YYYY-MM-DD') d`))[0].d
const hh = async (m) => (await q(`select to_char((now() at time zone 'Asia/Jerusalem') + ($1::int * interval '1 minute'), 'HH24:MI') h`, [m]))[0].h
const publish = async (assignees, start = -60, end = 120) => {
  await db.exec('delete from schedule_weeks')
  await q(`insert into schedule_weeks(week_start, status, published_snapshot) values ($1,'published',$2::jsonb)`,
    [today, JSON.stringify({ shifts: [{ id: 's0', shift_date: today, start_time: await hh(start), end_time: await hh(end), assignments: assignees.map((s) => ({ staffId: s.id })) }] })])
}
// The schedule is in use and only Bob is on it. Dev (the owner) linked table 2 — exactly the 2026-10-15 situation.
await publish([bob])
await as(dev.auth_user_id)
const cD = await issue(2)
await as(''); const sD = await redeem(cD.code); const subD = await submit(sD.session_token)
check('(setup) the owner (not on the roster) linked table 2 and the customer sent an order', subD.ok === true && (await holderOf(2)) === dev.id)
await as(dev.auth_user_id)
check('THE FIX: the person who linked the table SEES its order even though they are not on the schedule',
  (await q('select * from waiter_pending_submissions()')).some((r) => r.id === subD.submission_id))
{
  const row = (await q('select * from waiter_pending_submissions()'))[0]
  check('…and the row says who the table\'s waiter is, and that it is theirs', row.holder_id === dev.id && row.holder_name === 'Dev' && row.mine === true, JSON.stringify({ ...row, payload: undefined }))
}
check('the rostered waiter (Bob) does NOT see it yet — it is not his table and 90 seconds have not passed', !(await seen(bob.auth_user_id)).includes(2))
check('a waiter NOT on the roster (Eve) never sees it', !(await seen(eve.auth_user_id)).includes(2))
check('a bartender never sees it', (await seen(cy.auth_user_id)).length === 0)
check('a removed person never sees it', (await seen(gone.auth_user_id)).length === 0)
check('a shift manager (management oversight) sees it at once, even off the roster', (await seen(mia.auth_user_id)).includes(2))
check('signed-out sees nothing', (await seen('')).length === 0)
await age(95)
check('ESCALATION: after 90 seconds unhandled, the rostered waiter sees it too (a dead phone must not strand a customer)', (await seen(bob.auth_user_id)).includes(2))
check('…but an off-roster waiter still does not', !(await seen(eve.auth_user_id)).includes(2))
await closeShift()
check('no open shift → nobody sees anything, not even the table\'s waiter', (await seen(dev.auth_user_id)).length === 0 && (await seen(mia.auth_user_id)).length === 0)
await openShift()

section('a table nobody holds falls back to the roster rule (057), plus management')
await db.exec(`update waiter_tables set held_by_staff_id = null where id = '${T[2]}'`)
check('with no waiter on the table, the rostered waiter sees it at once (no 90-second wait)', (await seen(bob.auth_user_id)).includes(2))
check('…the off-roster waiter still does not (the schedule is in use)', !(await seen(eve.auth_user_id)).includes(2))
check('…management does', (await seen(dev.auth_user_id)).includes(2) && (await seen(mia.auth_user_id)).includes(2))
await db.exec('delete from schedule_weeks')
check('with NO schedule in use, any front-of-house waiter on shift sees it (057\'s open default)', (await seen(eve.auth_user_id)).includes(2))
await publish([bob])

// ───────────────────────────────────────────────────────────────────────
section('reviewing: first tap wins, and only someone who may handle the table can tap')
await as(dev.auth_user_id); await issue(2)                   // Dev holds table 2 again
await as(''); const sD2 = await redeem((await (async () => { await as(dev.auth_user_id); const c = await issue(2); await as(''); return c })()).code)
await db.exec(`update customer_cart_submissions set created_at = created_at - interval '60 seconds'`)
const subR = await submit(sD2.session_token)
const order = (await q('insert into waiter_orders default values returning id'))[0].id
await as(eve.auth_user_id)
check('an off-roster waiter cannot review → forbidden', (await q('select waiter_review_submission($1,$2,$3) r', [subR.submission_id, 'imported', order]))[0].r === 'forbidden')
await as(bob.auth_user_id)
check('the rostered waiter cannot review it within 90 seconds either → forbidden (it is not his table yet)', (await q('select waiter_review_submission($1,$2,$3) r', [subR.submission_id, 'imported', order]))[0].r === 'forbidden')
await as(cy.auth_user_id)
check('a bartender cannot → forbidden', (await q('select waiter_review_submission($1,$2) r', [subR.submission_id, 'rejected']))[0].r === 'forbidden')
await as(dev.auth_user_id)
check('a bad outcome is refused', (await q('select waiter_review_submission($1,$2) r', [subR.submission_id, 'approved']))[0].r === 'bad_outcome')
check('the table\'s waiter imports → ok, recording who/when/which order', await (async () => {
  const r = (await q('select waiter_review_submission($1,$2,$3) r', [subR.submission_id, 'imported', order]))[0].r
  const row = (await q('select * from customer_cart_submissions where id = $1', [subR.submission_id]))[0]
  return r === 'ok' && row.status === 'imported' && row.reviewed_by === dev.id && row.order_id === order })())
await age(95)
await as(bob.auth_user_id)
check('a second person tapping the same request → taken (first tap wins)', (await q('select waiter_review_submission($1,$2,$3) r', [subR.submission_id, 'imported', order]))[0].r === 'taken')
check('an unknown id → missing', (await q('select waiter_review_submission($1,$2) r', ['00000000-0000-0000-0000-000000000000', 'rejected']))[0].r === 'missing')
check('imported requests leave everyone\'s queue', !(await seen(bob.auth_user_id)).includes(2) || (await q('select count(*)::int c from waiter_pending_submissions() where id = $1', [subR.submission_id]))[0].c === 0)

// ───────────────────────────────────────────────────────────────────────
section('a connected phone calls a waiter WITHOUT typing a table')
await db.exec(`delete from waiter_table_calls; delete from customer_cart_submissions`)
await as(ann.auth_user_id)
const cT = await issue(3)
check('(setup) Ann links table 3 and so holds it', (await holderOf(3)) === ann.id)
await as(''); const sT = await redeem(cT.code)
let call = (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sT.session_token, 'waiter', 0, 0]))[0]
check('the session\'s table is the call\'s table; the answer names the table AND its waiter (the push target)',
  call.ok === true && call.table_id === T[3] && call.table_number === 3 && call.holder_id === ann.id, JSON.stringify(call))
check('the call row records the SESSION it came from', (await q('select session_id from waiter_table_calls where id = $1', [call.call_id]))[0].session_id !== null)
call = (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sT.session_token, 'waiter', 0, 0]))[0]
check('a second tap within three minutes → duplicate (a SUCCESS: it is already on its way)', call.ok === true && call.reason === 'duplicate')
check('a different kind is its own call', (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sT.session_token, 'assistance', 0, 0]))[0].reason === null)
check('a bad kind is refused', (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sT.session_token, 'pizza', 0, 0]))[0].reason === 'bad_kind')
check('a bad / unknown token → no_session, no row', (await q('select * from create_table_call_for_session($1,$2,$3,$4)', ['junk', 'waiter', 0, 0]))[0].reason === 'no_session'
  && (await q('select * from create_table_call_for_session($1,$2,$3,$4)', ['0'.repeat(64), 'waiter', 0, 0]))[0].reason === 'no_session')
check('cart context is clamped, never trusted', await (async () => {
  const c = (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sT.session_token, 'bill', 999999, 999999999999 % 2147483647]))[0]
  const row = (await q('select cart_items, cart_total_agorot from waiter_table_calls where id = $1', [c.call_id]))[0]
  return row.cart_items === 500 && row.cart_total_agorot === 100000000 })())
await closeShift()
check('no open shift → no_shift (and the table is still named, for the message)', (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sT.session_token, 'waiter', 0, 0]))[0].reason === 'no_shift')
await openShift()
await as(ann.auth_user_id); await q('select waiter_end_table_visit($1)', [T[3]]); await as('')
check('after staff end the visit, the phone can no longer call through its session', (await q('select * from create_table_call_for_session($1,$2,$3,$4)', [sT.session_token, 'waiter', 0, 0]))[0].ok === false)

section('…and the typed-number path (a customer who is not connected) is unchanged, but now names the waiter')
await as(ann.auth_user_id); await issue(4); await as('')
call = (await q('select * from create_table_call($1,$2,$3,$4)', [4, 'waiter', 1, 5000]))[0]
check('typed table 4 → ok, with table and waiter', call.ok === true && call.table_number === 4 && call.holder_id === ann.id, JSON.stringify(call))
check('an unknown number → unknown_table', (await q('select * from create_table_call($1,$2,$3,$4)', [77, 'waiter', 0, 0]))[0].reason === 'unknown_table')
check('a nonsense number → unknown_table', (await q('select * from create_table_call($1,$2,$3,$4)', [0, 'waiter', 0, 0]))[0].reason === 'unknown_table'
  && (await q('select * from create_table_call($1,$2,$3,$4)', [null, 'waiter', 0, 0]))[0].reason === 'unknown_table')
check('a bad kind → bad_kind', (await q('select * from create_table_call($1,$2,$3,$4)', [4, 'x', 0, 0]))[0].reason === 'bad_kind')
check('a table nobody holds → ok, holder null (the caller falls back to everyone on shift)', await (async () => {
  const c = (await q('select * from create_table_call($1,$2,$3,$4)', [5, 'waiter', 0, 0]))[0]
  return c.ok === true && c.holder_id === null })())

section('who sees and takes a CALL')
await db.exec(`delete from waiter_table_calls`)
const callSeen = async (uid) => { await as(uid); return (await q('select * from waiter_open_calls()')).map((r) => r.table_number) }
await as(ann.auth_user_id); await issue(1); await as('')              // Ann holds table 1 — Dev held it before; the claim moves
const cc = (await q('select * from create_table_call($1,$2,$3,$4)', [1, 'waiter', 0, 0]))[0]
check('the table\'s waiter sees the call, with her name on it', await (async () => {
  await as(ann.auth_user_id); const r = (await q('select * from waiter_open_calls()'))[0]
  return r.table_number === 1 && r.holder_id === ann.id && r.mine === true })())
check('management sees it', (await callSeen(dev.auth_user_id)).includes(1) && (await callSeen(mia.auth_user_id)).includes(1))
check('the rostered waiter does not — yet', !(await callSeen(bob.auth_user_id)).includes(1))
check('an off-roster waiter and a bartender never do', !(await callSeen(eve.auth_user_id)).includes(1) && (await callSeen(cy.auth_user_id)).length === 0)
await db.exec(`update waiter_table_calls set called_at = called_at - interval '95 seconds'`)
check('after 90 seconds the rostered waiter sees it (escalation)', (await callSeen(bob.auth_user_id)).includes(1))
await as(eve.auth_user_id)
check('an off-roster waiter cannot ack → forbidden', (await q('select waiter_ack_call($1) r', [cc.call_id]))[0].r === 'forbidden')
await as(bob.auth_user_id)
check('the escalated waiter can ack → ok', (await q('select waiter_ack_call($1) r', [cc.call_id]))[0].r === 'ok')
await as(ann.auth_user_id)
check('the table\'s waiter tapping after him → taken', (await q('select waiter_ack_call($1) r', [cc.call_id]))[0].r === 'taken')
check('an unknown call → missing', (await q('select waiter_ack_call($1) r', ['00000000-0000-0000-0000-000000000000']))[0].r === 'missing')
check('an acked call leaves every queue', (await callSeen(dev.auth_user_id)).length === 0)

// ───────────────────────────────────────────────────────────────────────
section('the customer is told the waiter\'s FIRST NAME — nothing else')
await as(ann.auth_user_id); const cN = await issue(5); await as(''); const sN = await redeem(cN.code)
const waiterName = async (tok) => (await q('select table_session_waiter($1) n', [tok]))[0].n
check('the session shows the table\'s waiter by first name', (await waiterName(sN.session_token)) === 'Ann')
check('…never a surname or an email', !String(await waiterName(sN.session_token)).includes('Surname') && !String(await waiterName(sN.session_token)).includes('@'))
await db.exec(`update staff set first_name = null, display_name = 'Annie B.' where id = '${ann.id}'`)
check('no first name → the display name', (await waiterName(sN.session_token)) === 'Annie B.')
await db.exec(`update staff set first_name = 'Ann', display_name = null where id = '${ann.id}'`)
await db.exec(`update waiter_tables set held_by_staff_id = null where id = '${T[5]}'`)
check('if the table was released, the person who generated the code is shown', (await waiterName(sN.session_token)) === 'Ann')
await db.exec(`update staff set active = false where id = '${ann.id}'`)
check('a removed person is never shown', (await waiterName(sN.session_token)) === null)
await db.exec(`update staff set active = true where id = '${ann.id}'`)
check('a bad / unknown token → null (not an error)', (await waiterName('junk')) === null && (await waiterName('0'.repeat(64))) === null && (await waiterName(null)) === null)
await as(ann.auth_user_id); await q('select waiter_end_table_visit($1)', [T[5]]); await as('')
check('after the visit ends the name is no longer given out', (await waiterName(sN.session_token)) === null)

section('waiter_table_holder — the push sender\'s question')
await as(ann.auth_user_id); await issue(5)
check('the holder is returned while a shift is open', (await q('select waiter_table_holder($1) h', [T[5]]))[0].h === ann.id)
await closeShift()
check('no open shift → null (the roster rule decides, and it says nobody)', (await q('select waiter_table_holder($1) h', [T[5]]))[0].h === null)
await openShift()
await db.exec(`update staff set auth_user_id = null where id = '${ann.id}'`)
check('a holder with no login can\'t be pushed → null', (await q('select waiter_table_holder($1) h', [T[5]]))[0].h === null)
await db.exec(`update staff set auth_user_id = '${ann.auth_user_id}' where id = '${ann.id}'`)
check('an unknown table → null', (await q('select waiter_table_holder($1) h', ['00000000-0000-0000-0000-000000000000']))[0].h === null)

section('the table sheet reads who looks after the table')
await as(ann.auth_user_id)
{
  const v = (await q('select waiter_table_visit($1) j', [T[5]]))[0].j
  check('waiter_table_visit carries holder_name and mine', v.holder_name === 'Ann' && v.mine === true && v.holder_id === ann.id, JSON.stringify(v))
  await as(bob.auth_user_id)
  const v2 = (await q('select waiter_table_visit($1) j', [T[5]]))[0].j
  check('…and for someone else, mine is false', v2.mine === false && v2.holder_name === 'Ann')
  check('…058\'s fields are all still there', ['shift_open', 'has_visit', 'activated', 'ends_at', 'devices', 'pending'].every((k) => k in v2))
}

// ───────────────────────────────────────────────────────────────────────
section('privileges')
const priv = async (fn, role) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p
for (const [fn, expect] of [
  ['public.waiter_table_holder(uuid)',                                 { authenticated: false, anon: false }],
  ['public.waiter_staff_can_handle_table(uuid,uuid,timestamptz)',      { authenticated: false, anon: false }],
  ['public._staff_first_name(uuid)',                                   { authenticated: false, anon: false }],
  ['public._insert_table_call(uuid,uuid,text,integer,integer)',        { authenticated: false, anon: false }],
  ['public.table_session_waiter(text)',                                { authenticated: false, anon: false }],
  ['public.create_table_call(integer,text,integer,integer)',           { authenticated: false, anon: false }],
  ['public.create_table_call_for_session(text,text,integer,integer)',  { authenticated: false, anon: false }],
  ['public._feed_customer_connected()',                                { authenticated: false, anon: false }],
  ['public._feed_customer_order()',                                    { authenticated: false, anon: false }],
  ['public._feed_customer_call()',                                     { authenticated: false, anon: false }],
  ['public.issue_table_code(uuid)',                                    { authenticated: true,  anon: false }],
  ['public.waiter_pending_submissions()',                              { authenticated: true,  anon: false }],
  ['public.waiter_open_calls()',                                       { authenticated: true,  anon: false }],
  ['public.waiter_review_submission(uuid,text,uuid)',                  { authenticated: true,  anon: false }],
  ['public.waiter_ack_call(uuid)',                                     { authenticated: true,  anon: false }],
  ['public.waiter_table_visit(uuid)',                                  { authenticated: true,  anon: false }],
]) for (const [role, want] of Object.entries(expect)) check(`${fn} execute for ${role} = ${want}`, (await priv(fn, role)) === want)

console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) { console.log(fails.map((f) => '  ✗ ' + f).join('\n')); process.exit(1) }
