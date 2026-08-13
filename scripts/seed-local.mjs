#!/usr/bin/env node
// Seed the LOCAL Supabase stack from the LIVE project.
//
// Read-only against live, write-only against local — it can never write to
// production. Run it after `supabase start` and `supabase db reset`:
//
//   node scripts/seed-local.mjs
//
// What it copies (the things that make local testing realistic):
//   app_settings   portal links, happy hour, the loyalty switches, reviews
//   menus          the real menu, draft + published
//   menu_variants  named versions / schedules the editor needs
//   waiter_tables  the real floor layout the owner already arranged
//   waiter_floor   canvas size + configured flag
//
// What it deliberately does NOT copy:
//   customers, auth.users, the real staff roster — that is real people's
//   personal data and none of it is needed to test this feature. Synthetic
//   staff are created instead (see TEST_STAFF below), each with a local
//   email+password login so multi-waiter testing needs no Google round-trip.
//
// No new dependencies: everything goes over the REST + admin APIs with fetch.

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

/* ── environment ──────────────────────────────────────────────────── */

function parseEnvFile(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const live = parseEnvFile('.env.local')
const LIVE_URL = live.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const LIVE_KEY = live.SUPABASE_SERVICE_ROLE_KEY

if (!LIVE_URL || !LIVE_KEY) {
  console.error('✗ .env.local is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (LIVE_URL.includes('127.0.0.1') || LIVE_URL.includes('localhost')) {
  console.error('✗ .env.local points at localhost — this script reads from LIVE. Aborting.')
  process.exit(1)
}

// Local connection details come straight from the CLI, so they can never be
// stale or hand-copied wrong.
const status = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8' }))
const LOCAL_URL = (status.API_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '')
const LOCAL_KEY = status.SERVICE_ROLE_KEY

if (!LOCAL_KEY) {
  console.error('✗ Could not read the local service role key. Is `supabase start` running?')
  process.exit(1)
}
// Belt and braces: refuse to run if "local" is anything but local.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(LOCAL_URL)) {
  console.error(`✗ Refusing to write to a non-local target: ${LOCAL_URL}`)
  process.exit(1)
}

const hdr = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
})

async function readLive(path) {
  const res = await fetch(`${LIVE_URL}/rest/v1/${path}`, { headers: hdr(LIVE_KEY) })
  if (!res.ok) throw new Error(`live read ${path} → ${res.status} ${await res.text()}`)
  return res.json()
}

async function writeLocal(table, rows, { upsert = true, onConflict } = {}) {
  if (!rows?.length) return 0
  // merge-duplicates resolves on the PRIMARY KEY unless on_conflict names
  // another unique column. Synthetic staff mint a fresh `id` every run while
  // auth_user_id stays fixed, so staff must resolve on auth_user_id or a
  // second run dies with 23505.
  const q = onConflict ? `?on_conflict=${onConflict}` : ''
  const res = await fetch(`${LOCAL_URL}/rest/v1/${table}${q}`, {
    method: 'POST',
    headers: {
      ...hdr(LOCAL_KEY),
      Prefer: upsert ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`local write ${table} → ${res.status} ${await res.text()}`)
  return rows.length
}

async function patchLocal(table, query, body) {
  const res = await fetch(`${LOCAL_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...hdr(LOCAL_KEY), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`local patch ${table} → ${res.status} ${await res.text()}`)
}

/* ── synthetic staff ──────────────────────────────────────────────── */
// Enough people to exercise all four access levels and a two-waiter table.
// Passwords are local-only and intentionally boring.

const TEST_STAFF = [
  { email: 'op@local.test',      password: 'localdev123', name: 'אופ מקומי', role: 'owner', badge: 'owner',           colour: '#ff8a5c' },
  { email: 'gm@local.test',      password: 'localdev123', name: 'גיל מנהל',  role: 'staff', badge: 'general_manager', colour: '#fb7185' },
  { email: 'ofir@local.test',    password: 'localdev123', name: 'אופיר',     role: 'staff', badge: 'waiter',          colour: '#34d399' },
  { email: 'dana@local.test',    password: 'localdev123', name: 'דנה',       role: 'staff', badge: 'waiter',          colour: '#60a5fa' },
  { email: 'shift@local.test',   password: 'localdev123', name: 'שי משמרת',  role: 'staff', badge: 'manager',         colour: '#c084fc' },
]

async function createLocalUser({ email, password, name }) {
  // Existing user? Reuse it so the script is re-runnable.
  const list = await fetch(
    `${LOCAL_URL}/auth/v1/admin/users?page=1&per_page=200`,
    { headers: hdr(LOCAL_KEY) }
  ).then((r) => r.json())
  const found = list?.users?.find((u) => u.email === email)
  if (found) return found.id

  const res = await fetch(`${LOCAL_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: hdr(LOCAL_KEY),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, name },
    }),
  })
  if (!res.ok) throw new Error(`create user ${email} → ${res.status} ${await res.text()}`)
  return (await res.json()).id
}

/* ── run ──────────────────────────────────────────────────────────── */

async function main() {
  console.log(`live  → ${LIVE_URL}`)
  console.log(`local → ${LOCAL_URL}\n`)

  // 1. Synthetic staff + local logins. FIRST, because menus.owner_id is NOT
  //    NULL and references a real auth user — the live owner's id does not
  //    exist locally, so the local OP account has to own the menu instead.
  const rows = []
  let opUserId = null
  for (const s of TEST_STAFF) {
    const id = await createLocalUser(s)
    if (s.badge === 'owner') opUserId = id
    rows.push({
      auth_user_id: id,
      email: s.email,
      display_name: s.name,
      role: s.role,
      badge: s.badge,
      // colour arrives with migration 021; harmless on an older database
      // because PostgREST just ignores an unknown key on insert.
      colour: s.colour,
    })
  }
  await writeLocal('staff', rows, { onConflict: 'auth_user_id' })
  console.log(`✓ staff             ${rows.length} (synthetic — no real PII copied)`)

  // 2. app_settings — portal links, happy hour, loyalty switches, reviews.
  const settings = await readLive('app_settings?select=*')
  // updated_by points at a live auth user that does not exist locally.
  await writeLocal('app_settings', settings.map((s) => ({ ...s, updated_by: null })))
  console.log(`✓ app_settings      ${settings.length}`)

  // 3. menus — insert with the variant pointer nulled first. menus.active_variant_id
  //    and menu_variants.menu_id reference each other, so the pointer has to be
  //    restored after the variants land (the circular-FK trap from HANDOFF.md).
  const menus = await readLive('menus?select=*')
  const pointers = menus.map((m) => ({ id: m.id, active_variant_id: m.active_variant_id ?? null }))
  await writeLocal('menus', menus.map((m) => ({ ...m, owner_id: opUserId, active_variant_id: null })))
  console.log(`✓ menus             ${menus.length} (owned locally by ${TEST_STAFF[0].email})`)

  const variants = await readLive('menu_variants?select=*')
  await writeLocal('menu_variants', variants)
  console.log(`✓ menu_variants     ${variants.length}`)

  for (const p of pointers) {
    if (p.active_variant_id) {
      await patchLocal('menus', `id=eq.${p.id}`, { active_variant_id: p.active_variant_id })
    }
  }

  // 4. The floor the owner already arranged — worth keeping, it took real work.
  //    Skipped on a database that has no waiter_* tables yet (they arrive with
  //    migration 019+), so this script stays runnable throughout the port.
  try {
    const tables = await readLive('waiter_tables?select=*&order=number.asc')
    await writeLocal('waiter_tables', tables)
    console.log(`✓ waiter_tables     ${tables.length}`)

    // Migration 022's zone→floor backfill ran before these rows existed, so
    // repeat it here. Live rows that already carry floor_id keep it (the
    // upsert wrote it); this only fills the gap for pre-022 exports.
    const floors = await fetch(`${LOCAL_URL}/rest/v1/waiter_floors?select=id,key`, { headers: hdr(LOCAL_KEY) }).then((r) => r.json())
    const fid = (key) => floors.find((f) => f.key === key)?.id
    if (fid('inside') && fid('outside')) {
      await patchLocal('waiter_tables', 'floor_id=is.null&zone=eq.חוץ', { floor_id: fid('outside') })
      await patchLocal('waiter_tables', 'floor_id=is.null', { floor_id: fid('inside') })
      console.log('✓ waiter_tables     floor_id backfilled (zone → floor)')
    }

    const floor = await readLive('waiter_floor?select=*')
    await writeLocal('waiter_floor', floor)
    console.log(`✓ waiter_floor      ${floor.length}`)
  } catch (e) {
    console.log(`· waiter_* skipped  (${e.message.slice(0, 60)}…)`)
  }

  console.log('\nLocal logins (email / password):')
  for (const s of TEST_STAFF) console.log(`  ${s.email.padEnd(20)} ${s.password}   ${s.badge}`)
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}`)
  process.exit(1)
})
