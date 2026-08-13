#!/usr/bin/env node
// The isolation probe, run against the LOCAL stack.
//
// STAFF_APP.md's standing rule: after any waiter_* RLS change, re-verify live —
// both directions — rather than assuming. This automates that probe so it is
// cheap enough to actually run every time.
//
//   node scripts/check-isolation.mjs
//
// Why an INSERT and not a PATCH: a zero-row PATCH/DELETE returns 204 whether
// the write was permitted or RLS silently filtered every row. That ambiguity is
// how the original lockdown gap was missed. An insert of `{}` is guaranteed to
// fail — and WHICH failure tells the two apart:
//     42501 = RLS blocked it        (what we want for a denied write)
//     23502 = not-null violation    (the write was ALLOWED through — a hole)

import { execSync } from 'node:child_process'

const st = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8' }))
const URL_ = st.API_URL.replace(/\/+$/, '')
const ANON = st.ANON_KEY

if (!/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(URL_)) {
  console.error(`✗ Refusing to probe a non-local target: ${URL_}`)
  process.exit(1)
}

let pass = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name} — ${detail}`) }
}

/** Sign in and return the user's access token (NOT the anon key). */
async function signIn(email, password) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`sign-in ${email} → ${res.status} ${await res.text()}`)
  return (await res.json()).access_token
}

async function selectRows(table, token) {
  const res = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=5`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  const body = await res.text()
  return { status: res.status, rows: res.ok ? JSON.parse(body).length : null, body }
}

/** Returns the postgres error code, or 'ALLOWED' if the write got through. */
async function probeInsert(table, token) {
  const res = await fetch(`${URL_}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (res.ok) return 'ALLOWED'
  try { return JSON.parse(await res.text()).code } catch { return `http_${res.status}` }
}

async function createOutsider() {
  const email = `outsider-${Date.now()}@local.test`
  const password = 'localdev123'
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: st.SERVICE_ROLE_KEY, Authorization: `Bearer ${st.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`create outsider → ${res.status} ${await res.text()}`)
  return { email, password }
}

/* Tables this project owns. A staff token must never be able to write to any
   of them — that isolation is the whole reason two apps can share one DB. */
const PORTAL_TABLES = ['menus', 'staff', 'customers', 'app_settings', 'rewards']
const WAITER_TABLES = ['waiter_orders', 'waiter_order_items', 'waiter_order_batches']

async function main() {
  console.log(`probing ${URL_}\n`)

  /* ── 1. Anonymous gets nothing ──────────────────────────────────── */
  console.log('anonymous (anon key only):')
  for (const t of WAITER_TABLES) {
    const code = await probeInsert(t, ANON)
    check(`${t} write blocked`, code === '42501', `got ${code}`)
  }
  const anonRead = await selectRows('waiter_tables', ANON)
  check('waiter_tables read returns nothing', anonRead.rows === 0, `got ${anonRead.rows} rows`)

  /* ── 2. Signed in, but NOT staff — the Google-account-is-not-authorization
        case. Anyone can get a Google account; that must buy nothing. ── */
  console.log('\nsigned in but not in public.staff:')
  const outsider = await createOutsider()
  const outsiderToken = await signIn(outsider.email, outsider.password)
  for (const t of WAITER_TABLES) {
    const code = await probeInsert(t, outsiderToken)
    check(`${t} write blocked`, code === '42501', `got ${code}`)
  }
  const outRead = await selectRows('waiter_tables', outsiderToken)
  check('waiter_tables read returns nothing', outRead.rows === 0, `got ${outRead.rows} rows`)

  /* ── 3. Signed-in staff CAN use the staff app ───────────────────── */
  console.log('\nsigned-in staff (ofir@local.test, badge=waiter):')
  const staffToken = await signIn('ofir@local.test', 'localdev123')
  const staffRead = await selectRows('waiter_tables', staffToken)
  check('waiter_tables readable', staffRead.rows > 0, `got ${staffRead.rows} rows`)
  const floorRead = await selectRows('waiter_floor', staffToken)
  check('waiter_floor readable', floorRead.rows > 0, `got ${floorRead.rows} rows`)
  // A real insert, not the {} probe — this must actually succeed.
  const realInsert = await fetch(`${URL_}/rest/v1/waiter_orders`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ waiter_name: 'probe', status: 'open', total_agorot: 0 }),
  })
  check('can open an order', realInsert.ok, `http ${realInsert.status} ${realInsert.ok ? '' : await realInsert.text()}`)
  if (realInsert.ok) {
    const [row] = await realInsert.json()
    await fetch(`${URL_}/rest/v1/waiter_orders?id=eq.${row.id}`, {
      method: 'DELETE', headers: { apikey: ANON, Authorization: `Bearer ${staffToken}` },
    })
  }

  /* ── 4. …and STILL cannot touch anything the portal owns ────────── */
  console.log('\nsigned-in staff against the portal’s own tables:')
  for (const t of PORTAL_TABLES) {
    const code = await probeInsert(t, staffToken)
    check(`${t} write blocked`, code === '42501', `got ${code}`)
  }

  /* ── 5. The audit log is append-only for everyone ───────────────── */
  console.log('\nappend-only guarantee:')
  for (const t of ['waiter_order_events', 'waiter_floor_history']) {
    const res = await fetch(`${URL_}/rest/v1/${t}?id=gt.0`, {
      method: 'DELETE',
      headers: { apikey: ANON, Authorization: `Bearer ${staffToken}`, Prefer: 'count=exact' },
    })
    // No DELETE policy exists, so PostgREST reports zero rows affected.
    const affected = res.headers.get('content-range')
    check(`${t} delete affects nothing`, affected?.startsWith('*/0') || affected === '*/0' || res.status === 403 || affected?.endsWith('/0'),
      `content-range=${affected} status=${res.status}`)
  }

  const total = pass + failures.length
  if (failures.length) {
    console.error(`\n✗ ${failures.length}/${total} failed`)
    process.exit(1)
  }
  console.log(`\n✓ isolation holds — ${pass}/${total} probes passed`)
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1) })
