#!/usr/bin/env node
// Offline test of migrations 059 (STAFF JOIN LINKS) and 060 (the PAYSLIP library) against an in-memory Postgres —
// PGlite, WebAssembly, no Docker. It applies the REAL files, stubbing only what they reference (auth.users,
// auth.identities, public.staff with the unique indexes 006 adds, storage.buckets).
//
//   node scripts/check-migration-059-060.mjs
//
// WHY IT EXISTS: there is no local Supabase stack here (no Docker) and CLAUDE.md forbids applying a migration without
// the owner's per-migration approval, so the only way to know a drafted migration does what its comments claim BEFORE
// asking for that approval is to run it somewhere harmless. (The same reasoning as check-migration-058.mjs.)
//
// WHAT IT PROVES
//   059 — a join link is a bearer secret that is: stored only as a hash; single-use; expiring; revocable by re-issuing;
//         bound to ONE unlinked, active, non-owner staff row; claimable only by a confirmed GOOGLE identity; and a
//         refused claim changes NOTHING. A link can never hand over admin, and can never take over a row already
//         linked to someone else. Every function is callable by service_role and nobody else.
//   060 — the payslip tables are closed (RLS on, no policies), their CHECKs are the rules rules.ts states, the access
//         log REFUSES update and delete even for a superuser-ish role, a person with payslips cannot be deleted, and
//         re-running the file can never flip the bucket public.
//
// WHAT IT CANNOT PROVE: production's real grants/RLS/advisors (verify those after applying: get_advisors,
// has_function_privilege) and true concurrency (one connection) — the double-use race is decided by the row lock in
// staff_join_claim, which is reasoned about in the migration, not raced here.

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ROOT = new URL('../supabase/migrations/', import.meta.url)
const db = new PGlite({ extensions: { pgcrypto } })

let pass = 0
const fails = []
const check = (n, ok, d = '') => { if (ok) { pass++; console.log('  ✓', n) } else { fails.push(n); console.log('  ✗', n, d) } }
const section = (s) => console.log(`\n${s}`)
const q = async (sql, params) => (await db.query(sql, params)).rows
const threw = async (sql, params) => { try { await q(sql, params); return null } catch (e) { return e } }
const sha = (s) => createHash('sha256').update(s).digest('hex')
const tok = () => randomBytes(32).toString('base64url')

// ── stubs ──────────────────────────────────────────────────────────────
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions; create schema storage;
  create extension pgcrypto with schema extensions;
  create table auth.users (
    id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id), provider text not null);
  create table public.staff (
    id uuid primary key default gen_random_uuid(), auth_user_id uuid, role text not null default 'staff', badge text,
    active boolean not null default true, first_name text, last_name text, email text, claimed_at timestamptz);
  create unique index staff_auth_user_id_key on public.staff (auth_user_id);
  create unique index staff_email_lower_key on public.staff (lower(email)) where email is not null;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
`)

section('the real files apply')
for (const f of ['059_staff_join_links.sql', '060_staff_payslips.sql']) {
  try { await db.exec(readFileSync(new URL(f, ROOT), 'utf8')); check(`${f} applies cleanly`, true) }
  catch (e) { check(`${f} applies cleanly`, false, e.message) }
}
for (const f of ['059_staff_join_links.sql', '060_staff_payslips.sql']) {
  try { await db.exec(readFileSync(new URL(f, ROOT), 'utf8')); check(`${f} is idempotent (re-run is harmless)`, true) }
  catch (e) { check(`${f} is idempotent (re-run is harmless)`, false, e.message) }
}

// ── people ─────────────────────────────────────────────────────────────
const mkUser = async ({ email, google = true, confirmed = true, meta = {} } = {}) => {
  const u = (await q(`insert into auth.users(email, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3) returning id`,
    [email, confirmed ? new Date().toISOString() : null, JSON.stringify(meta)]))[0]
  if (google) await q(`insert into auth.identities(user_id, provider) values ($1, 'google')`, [u.id])
  return u.id
}
const mkStaff = async (o = {}) => (await q(
  `insert into staff(auth_user_id, role, badge, active, first_name, last_name, email) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
  [o.auth ?? null, o.role ?? 'staff', o.badge ?? null, o.active ?? true, o.first ?? null, o.last ?? null, o.email ?? null]))[0].id

const issue = async (staff, hash, actor = null, ttl) => (await q('select public.staff_join_issue($1,$2,$3,$4) r', [staff, hash, actor, ttl ?? 168]))[0].r
const peek = async (hash) => (await q('select public.staff_join_peek($1) r', [hash]))[0].r
const claim = async (hash, user) => (await q('select public.staff_join_claim($1,$2) r', [hash, user]))[0].r
const revoke = async (staff) => (await q('select public.staff_join_revoke($1) r', [staff]))[0].r
const row = async (id) => (await q('select * from staff where id = $1', [id]))[0]
const links = async (staff) => q('select * from staff_join_links where staff_id = $1 order by created_at', [staff])

const actor = await mkStaff({ role: 'owner', badge: 'owner', first: 'Boss', auth: await mkUser({ email: 'boss@gmail.com' }) })

// ───────────────────────────────────────────────────────────────────────
section('059 · issuing a link')
const dana = await mkStaff({ first: 'דנה', badge: 'waiter' })           // offline row: no email, no login
const t1 = tok(), h1 = sha(t1)
let r = await issue(dana, h1, actor)
check('an owner can issue a link for an unlinked person', r.ok === true && !!r.expires_at, JSON.stringify(r))
{
  const l = (await links(dana))[0]
  check('only the SHA-256 is stored — never the token', l.token_hash === h1 && l.token_hash !== t1 && l.token_hash.length === 64)
  const hours = (new Date(l.expires_at) - new Date(l.created_at)) / 3_600_000
  check('the default lifetime is 7 days (TTL default 168h)', Math.abs(hours - 168) < 0.01, `${hours}`)
  check('who made it is recorded', l.created_by === actor)
}
const t2 = tok(), h2 = sha(t2)
r = await issue(dana, h2, actor)
{
  const ls = await links(dana)
  const live = ls.filter((l) => !l.used_at && !l.revoked_at)
  check('issuing again REVOKES the old link — exactly one is live', r.ok && ls.length === 2 && live.length === 1 && live[0].token_hash === h2 && ls[0].revoked_at !== null)
}
check('the unique-live index makes two live links unrepresentable even by a direct insert',
  (await threw(`insert into staff_join_links(staff_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')`, [dana, sha('x')]))?.code === '23505')
{
  const s = await mkStaff({ first: 'א' })
  await issue(s, sha('ttl-low'), actor, 0)
  await issue(await mkStaff({ first: 'ב' }), sha('ttl-high'), actor, 99999)
  const lo = (await links(s))[0]
  const hi = (await q(`select * from staff_join_links where token_hash = $1`, [sha('ttl-high')]))[0]
  const h = (l) => Math.round((new Date(l.expires_at) - new Date(l.created_at)) / 3_600_000)
  check('a lifetime is clamped to 1 hour at the least and 720 hours (30 days) at the most', h(lo) === 1 && h(hi) === 720, `${h(lo)} ${h(hi)}`)
}
check('a malformed hash is refused', (await issue(dana, 'not-a-hash', actor)).reason === 'bad_hash' && (await issue(dana, null, actor)).reason === 'bad_hash'
  && (await issue(dana, sha('a').toUpperCase(), actor)).reason === 'bad_hash')
check('an unknown person is refused', (await issue('00000000-0000-0000-0000-000000000000', sha('b'), actor)).reason === 'no_staff')
check('a REMOVED person is refused', (await issue(await mkStaff({ first: 'x', active: false }), sha('c'), actor)).reason === 'inactive')
check('someone who already has a login is refused (no link is needed)',
  (await issue(await mkStaff({ first: 'y', auth: await mkUser({ email: 'y@gmail.com' }) }), sha('d'), actor)).reason === 'already_linked')
check('an OWNER row is refused — a link can never hand over admin (role)', (await issue(await mkStaff({ first: 'o', role: 'owner' }), sha('e'), actor)).reason === 'owner_role')
check('…nor an owner-BADGE row', (await issue(await mkStaff({ first: 'p', badge: 'owner' }), sha('f'), actor)).reason === 'owner_role')
check('a pending email invite (email set, no login) CAN get a link — that is the "I typed the wrong address" rescue',
  (await issue(await mkStaff({ first: 'q', email: 'typo@gmial.com' }), sha('g'), actor)).ok === true)

// ───────────────────────────────────────────────────────────────────────
section('059 · peek — what the wizard may learn from a link')
{
  const p = await peek(h2)
  check('a live link says who it is for: first name and job title', p.status === 'ok' && p.first_name === 'דנה' && p.badge === 'waiter')
  check('…and NOTHING else (no id, no email, no last name)', JSON.stringify(Object.keys(p).sort()) === JSON.stringify(['badge', 'expires_at', 'first_name', 'status']), Object.keys(p).join())
  check('the old (revoked) link reads as revoked', (await peek(h1)).status === 'revoked')
  check('revoked/unknown links reveal no name', (await peek(h1)).first_name === undefined && (await peek(sha('nope'))).first_name === undefined)
  check('an unknown token reads as unknown', (await peek(sha('nobody'))).status === 'unknown')
  check('a malformed token reads as unknown too (same answer — nothing to tell them apart)', (await peek('xyz')).status === 'unknown' && (await peek(null)).status === 'unknown')
}

// ───────────────────────────────────────────────────────────────────────
section('059 · claiming — the happy path')
const googleDana = await mkUser({ email: 'Dana.Cohen@Gmail.com', meta: { given_name: 'Dana', family_name: 'Cohen' } })
r = await claim(h2, googleDana)
{
  const s = await row(dana)
  check('the Google account becomes the row’s login', r.ok === true && r.already === false && r.staff_id === dana && s.auth_user_id === googleDana)
  check('the VERIFIED Google address is written to the row', s.email === 'Dana.Cohen@Gmail.com')
  check('claimed_at is stamped', s.claimed_at !== null)
  check('the owner’s typed first name WINS over Google’s ("דנה", not "Dana")', s.first_name === 'דנה')
  check('…while a blank last name is filled from the Google profile', s.last_name === 'Cohen')
  const l = (await links(dana)).find((x) => x.token_hash === h2)
  check('the link is spent and records who used it', l.used_at !== null && l.used_by === googleDana)
  check('a spent link now reads as used', (await peek(h2)).status === 'used')
}
r = await claim(h2, googleDana)
check('the same person confirming AGAIN (a reload, a double tap) is a success, not an error', r.ok === true && r.already === true)
{
  const stranger = await mkUser({ email: 'stranger@gmail.com' })
  r = await claim(h2, stranger)
  check('a DIFFERENT account using the spent link is refused (used)', r.ok === false && r.reason === 'used')
  check('…and the row is untouched', (await row(dana)).auth_user_id === googleDana)
}

// ───────────────────────────────────────────────────────────────────────
section('059 · claiming — every refusal changes nothing')
const snapshot = async (ids) => JSON.stringify(await Promise.all(ids.map(async (i) => { const s = await row(i); return [s.auth_user_id, s.email, s.first_name, s.last_name, s.claimed_at] })))
{
  const s = await mkStaff({ first: 'ברק', badge: 'bartender' })
  const t = tok(), h = sha(t)
  await issue(s, h, actor)
  const before = await snapshot([s])
  const noGoogle = await mkUser({ email: 'pw@example.com', google: false })
  const unconfirmed = await mkUser({ email: 'unconf@gmail.com', confirmed: false })
  const noEmail = await mkUser({ email: null })
  check('an account with NO Google identity is refused', (await claim(h, noGoogle)).reason === 'not_google')
  check('an UNCONFIRMED address is refused', (await claim(h, unconfirmed)).reason === 'not_google')
  check('an account with no email is refused', (await claim(h, noEmail)).reason === 'not_google')
  check('an unknown user id is refused', (await claim(h, '00000000-0000-0000-0000-000000000000')).reason === 'no_user')
  check('an unknown token is refused', (await claim(sha('zzz'), await mkUser({ email: 'z1@gmail.com' }))).reason === 'unknown')
  check('a malformed token is refused', (await claim('abc', await mkUser({ email: 'z2@gmail.com' }))).reason === 'unknown')
  check('…none of which touched the row or spent the link', (await snapshot([s])) === before && (await peek(h)).status === 'ok')

  // somebody who is already on the roster
  const existing = await mkUser({ email: 'already@gmail.com' })
  await mkStaff({ first: 'already', auth: existing, email: 'already@gmail.com' })
  r = await claim(h, existing)
  check('a Google account that is ALREADY on the roster is refused (already_staff)', r.reason === 'already_staff')
  check('…and the link is still usable by the right person', (await peek(h)).status === 'ok' && (await snapshot([s])) === before)

  // an address already written on another row
  const twin = await mkStaff({ first: 'twin', email: 'barak@gmail.com' })
  const barak = await mkUser({ email: 'BARAK@gmail.com' })
  r = await claim(h, barak)
  check('an address already on a DIFFERENT row is refused (email_in_use, case-insensitive)', r.reason === 'email_in_use')
  check('…atomically: nothing was written, the link is not spent', (await snapshot([s])) === before && (await peek(h)).status === 'ok' && (await row(twin)).auth_user_id === null)

  // and the success once it is the right account
  r = await claim(h, await mkUser({ email: 'barak.real@gmail.com' }))
  check('the right account then succeeds', r.ok === true && (await row(s)).email === 'barak.real@gmail.com')
}
{
  // revoked / expired / inactive / owner / taken
  const s = await mkStaff({ first: 'רונית' }); const h = sha(tok()); await issue(s, h, actor)
  await revoke(s)
  check('a REVOKED link is refused', (await claim(h, await mkUser({ email: 'rv@gmail.com' }))).reason === 'revoked')

  const s2 = await mkStaff({ first: 'תמר' }); const h2x = sha(tok()); await issue(s2, h2x, actor)
  await q(`update staff_join_links set created_at = now() - interval '9 days', expires_at = now() - interval '2 days' where token_hash = $1`, [h2x])
  check('an EXPIRED link is refused', (await claim(h2x, await mkUser({ email: 'ex@gmail.com' }))).reason === 'expired')
  check('…and peek says expired, with no name', (await peek(h2x)).status === 'expired' && (await peek(h2x)).first_name === undefined)

  const s3 = await mkStaff({ first: 'גיל' }); const h3 = sha(tok()); await issue(s3, h3, actor)
  await q(`update staff set active = false where id = $1`, [s3])
  check('a person REMOVED after the link was sent cannot be joined (inactive)', (await claim(h3, await mkUser({ email: 'in@gmail.com' }))).reason === 'inactive')
  check('…and peek says inactive', (await peek(h3)).status === 'inactive')

  const s4 = await mkStaff({ first: 'נועם' }); const h4 = sha(tok()); await issue(s4, h4, actor)
  await q(`update staff set role = 'owner' where id = $1`, [s4])
  const attacker = await mkUser({ email: 'grab-admin@gmail.com' })
  check('a row PROMOTED to owner after the link was sent can no longer be claimed by link (owner_role) — no admin by forwarded link',
    (await claim(h4, attacker)).reason === 'owner_role' && (await row(s4)).auth_user_id === null)

  const s5 = await mkStaff({ first: 'שיר' }); const h5 = sha(tok()); await issue(s5, h5, actor)
  const other = await mkUser({ email: 'got-in-first@gmail.com' })
  await q(`update staff set auth_user_id = $1 where id = $2`, [other, s5])
  check('a row linked another way after the link was sent is "taken" and is not overwritten',
    (await claim(h5, await mkUser({ email: 'late@gmail.com' }))).reason === 'taken' && (await row(s5)).auth_user_id === other)
  check('…and peek says linked', (await peek(h5)).status === 'linked')
  check('the row’s own person reusing a link after getting in another way is a SUCCESS (already)',
    (await claim(h5, other)).already === true)
}

// ───────────────────────────────────────────────────────────────────────
section('059 · the person who typed the wrong address')
{
  const s = await mkStaff({ first: 'לימור', email: 'limor@gmial.com' })          // pending invite with a typo
  const h = sha(tok()); await issue(s, h, actor)
  const real = await mkUser({ email: 'limor.real@gmail.com' })
  r = await claim(h, real)
  const after = await row(s)
  check('the link rescues a mistyped pending invite — and the verified address replaces the typo',
    r.ok === true && after.auth_user_id === real && after.email === 'limor.real@gmail.com')
}

// ───────────────────────────────────────────────────────────────────────
section('059 · revoke')
{
  const s = await mkStaff({ first: 'אורי' }); const h = sha(tok()); await issue(s, h, actor)
  check('revoke reports how many live links it cancelled', (await revoke(s)) === 1 && (await revoke(s)) === 0)
  check('…and a revoked link peeks as revoked', (await peek(h)).status === 'revoked')
  check('revoking a spent link is a no-op (history stays)', (await revoke(dana)) === 0 && (await peek(h2)).status === 'used')
}

// ───────────────────────────────────────────────────────────────────────
section('059 · the table’s own constraints and posture')
{
  const s = await mkStaff({ first: 'c' })
  check('token_hash must be 64 lowercase hex', (await threw(`insert into staff_join_links(staff_id, token_hash, expires_at) values ($1,'abc', now()+interval '1 day')`, [s]))?.code === '23514'
    && (await threw(`insert into staff_join_links(staff_id, token_hash, expires_at) values ($1,$2, now()+interval '1 day')`, [s, 'A'.repeat(64)]))?.code === '23514')
  check('expires_at must be after created_at', (await threw(`insert into staff_join_links(staff_id, token_hash, expires_at) values ($1,$2, now() - interval '1 day')`, [s, sha('past')]))?.code === '23514')
  check('the same hash cannot be stored twice', (await threw(`insert into staff_join_links(staff_id, token_hash, expires_at) values ($1,$2, now()+interval '1 day')`, [await mkStaff({ first: 'd' }), h2]))?.code === '23505')
  const rls = (await q(`select relrowsecurity r from pg_class where oid = 'public.staff_join_links'::regclass`))[0].r
  const pol = (await q(`select count(*)::int n from pg_policies where tablename = 'staff_join_links'`))[0].n
  check('RLS is ON and there are ZERO policies (service-role routes only)', rls === true && pol === 0)
}
{
  const priv = async (fn, role) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p
  for (const fn of ['public.staff_join_issue(uuid,text,uuid,integer)', 'public.staff_join_peek(text)', 'public.staff_join_claim(text,uuid)', 'public.staff_join_revoke(uuid)']) {
    const name = fn.split('(')[0]
    check(`${name}: service_role yes — anon no — authenticated no`,
      (await priv(fn, 'service_role')) === true && (await priv(fn, 'anon')) === false && (await priv(fn, 'authenticated')) === false)
  }
  const defs = (await q(`select proname, prosecdef, proconfig from pg_proc where proname like 'staff_join_%'`))
  check('every function is SECURITY DEFINER with a pinned search_path (no schema-shadowing)',
    defs.length === 4 && defs.every((d) => d.prosecdef && (d.proconfig ?? []).some((c) => /search_path=public, pg_temp/.test(c))), JSON.stringify(defs))
}

// ═══════════════════════════════════════════════════════════════════════
section('060 · the payslip tables')
const SID = (await mkStaff({ first: 'עובד', last: 'לדוגמה' }))
const FILE = (staff = SID, period = '2026-09', id = null) => `${staff}/${period}/${id ?? crypto.randomUUID()}.pdf`
const insertSlip = async (o = {}) => (await q(
  `insert into staff_payslips(staff_id, period, file_path, file_name, file_mime, file_bytes, note) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
  [o.staff ?? SID, o.period ?? '2026-09-01', o.path ?? FILE(), o.name ?? 'תלוש.pdf', o.mime ?? 'application/pdf', o.bytes ?? 1000, o.note ?? '']))[0].id
const slip = await insertSlip()
check('a good payslip row inserts', !!slip)
check('a period that is not the 1st is refused', (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2026-09-15',$2,'application/pdf',10)`, [SID, FILE()]))?.code === '23514')
check('a period outside 2000–2100 is refused', (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'1999-12-01',$2,'application/pdf',10)`, [SID, FILE()]))?.code === '23514'
  && (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2101-01-01',$2,'application/pdf',10)`, [SID, FILE()]))?.code === '23514')
for (const bad of ['../../etc/passwd', `${SID}/2026-09/${crypto.randomUUID()}.exe`, `${SID}/2026-09/${crypto.randomUUID()}.svg`, `${SID}/2026-09/${crypto.randomUUID()}.html`, `${SID}/2026-9/${crypto.randomUUID()}.pdf`, `x/${crypto.randomUUID()}.pdf`]) {
  check(`file_path "${bad.slice(0, 44)}…" is refused`, (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2026-09-01',$2,'application/pdf',10)`, [SID, bad]))?.code === '23514')
}
check('an SVG/HTML/ZIP MIME is refused', (await Promise.all(['image/svg+xml', 'text/html', 'application/zip', 'application/octet-stream'].map(async (m) =>
  (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2026-09-01',$2,$3,10)`, [SID, FILE(), m]))?.code))).every((c) => c === '23514'))
check('size must be 1 … 8 MiB', (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2026-09-01',$2,'application/pdf',0)`, [SID, FILE()]))?.code === '23514'
  && (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2026-09-01',$2,'application/pdf',8388609)`, [SID, FILE()]))?.code === '23514'
  && !(await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2026-09-01',$2,'application/pdf',8388608)`, [SID, FILE()])))
check('a note over 300 characters is refused', (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes, note) values ($1,'2026-09-01',$2,'application/pdf',10,$3)`, [SID, FILE(), 'x'.repeat(301)]))?.code === '23514')
check('a file name over 200 characters is refused', (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes, file_name) values ($1,'2026-09-01',$2,'application/pdf',10,$3)`, [SID, FILE(), 'x'.repeat(201)]))?.code === '23514')
check('the same storage path cannot be used twice', (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values ($1,'2026-09-01',(select file_path from staff_payslips limit 1),'application/pdf',10)`, [SID]))?.code === '23505')
check('SEVERAL payslips for the same person and month are allowed (a correction is a new row)', !!(await insertSlip({ period: '2026-09-01' })) && !!(await insertSlip({ period: '2026-09-01' })))
check('a payslip for someone who does not exist is refused', (await threw(`insert into staff_payslips(staff_id, period, file_path, file_mime, file_bytes) values (gen_random_uuid(),'2026-09-01',$1,'application/pdf',10)`, [FILE()]))?.code === '23503')
check('a person WITH payslips cannot be deleted (ON DELETE RESTRICT → SQLSTATE 23001)', (await threw(`delete from staff where id = $1`, [SID]))?.code === '23001')

section('060 · the access log is append-only')
await q(`insert into staff_payslip_events(payslip_id, actor_staff_id, kind) values ($1,$2,'uploaded')`, [slip, actor])
const ev = (await q(`select id from staff_payslip_events limit 1`))[0].id
check('every kind in the vocabulary inserts', (await Promise.all(['viewed', 'downloaded', 'zipped', 'removed'].map(async (k) =>
  threw(`insert into staff_payslip_events(payslip_id, actor_staff_id, kind) values ($1,$2,$3)`, [slip, actor, k])))).every((e) => e === null))
check('an unknown kind is refused', (await threw(`insert into staff_payslip_events(payslip_id, kind) values ($1,'peeked')`, [slip]))?.code === '23514')
check('UPDATE is refused by the database itself', (await threw(`update staff_payslip_events set kind = 'viewed' where id = $1`, [ev]))?.code === '42501')
check('DELETE is refused by the database itself', (await threw(`delete from staff_payslip_events where id = $1`, [ev]))?.code === '42501')
check('…even a bulk delete / update', (await threw(`delete from staff_payslip_events`))?.code === '42501' && (await threw(`update staff_payslip_events set at = now()`))?.code === '42501')
check('an event needs a real payslip', (await threw(`insert into staff_payslip_events(payslip_id, kind) values (gen_random_uuid(),'viewed')`, []))?.code === '23503')
check('a payslip that has events cannot be deleted (history is kept)', (await threw(`delete from staff_payslips where id = $1`, [slip]))?.code === '23001')
check('removal is a tombstone: marking removed_at is allowed on the payslip row', !(await threw(`update staff_payslips set removed_at = now(), removed_by = $2 where id = $1`, [slip, actor])))

section('060 · posture')
{
  for (const t of ['staff_payslips', 'staff_payslip_events']) {
    const rls = (await q(`select relrowsecurity r from pg_class where oid = $1::regclass`, [`public.${t}`]))[0].r
    const pol = (await q(`select count(*)::int n from pg_policies where tablename = $1`, [t]))[0].n
    check(`${t}: RLS ON, zero policies`, rls === true && pol === 0)
  }
  const priv = async (fn, role) => (await q(`select has_function_privilege($1, $2, 'execute') p`, [role, fn]))[0].p
  check('the append-only trigger function is not callable by anon/authenticated', (await priv('public._staff_payslip_events_append_only()', 'anon')) === false && (await priv('public._staff_payslip_events_append_only()', 'authenticated')) === false)
  const b = (await q(`select * from storage.buckets where id = 'payslips'`))[0]
  check('the bucket exists, is PRIVATE, 8 MiB, and allows exactly PDF/JPEG/PNG/WebP',
    !!b && b.public === false && Number(b.file_size_limit) === 8388608 &&
    JSON.stringify([...b.allowed_mime_types].sort()) === JSON.stringify(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']), JSON.stringify(b))
  await q(`update storage.buckets set public = true, file_size_limit = 1, allowed_mime_types = array['text/html'] where id = 'payslips'`)
  await db.exec(readFileSync(new URL('060_staff_payslips.sql', ROOT), 'utf8'))
  const b2 = (await q(`select * from storage.buckets where id = 'payslips'`))[0]
  check('RE-RUNNING the file puts the bucket back to private/8MiB/the four types — it can never flip it public',
    b2.public === false && Number(b2.file_size_limit) === 8388608 && b2.allowed_mime_types.length === 4)
  check('the files carry the "NOT YET APPLIED" warning (so nobody applies them by habit)',
    /NOT YET APPLIED/.test(readFileSync(new URL('059_staff_join_links.sql', ROOT), 'utf8')) && /NOT YET APPLIED/.test(readFileSync(new URL('060_staff_payslips.sql', ROOT), 'utf8')))
}

console.log(`\n${pass} passed, ${fails.length} failed`)
if (fails.length) { console.log('\nFailures:\n  - ' + fails.join('\n  - ')); process.exit(1) }
