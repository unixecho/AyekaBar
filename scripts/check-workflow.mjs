#!/usr/bin/env node
// Workflow harness for migrations 022–024: assignment, labels, layout
// permissions, guests, item lifecycle, and database-stamped identity.
//
//   node scripts/check-workflow.mjs        (local stack only — refuses remote)
//
// Everything here goes through PostgREST as a signed-in user, exactly like
// the app does — no service-role shortcuts except for setup/teardown. The
// point is to prove the DATABASE enforces the rules even against a hostile
// client: every probe that "spoofs" an identity checks the spoof was
// overwritten or rejected.

import { execSync } from 'node:child_process'

const st = JSON.parse(execSync('supabase status -o json', { encoding: 'utf8' }))
const URL_ = st.API_URL.replace(/\/+$/, '')
const ANON = st.ANON_KEY
const SVC = st.SERVICE_ROLE_KEY

if (!/^https?:\/\/(127\.0\.0\.1|localhost)\b/.test(URL_)) {
  console.error(`✗ Refusing to probe a non-local target: ${URL_}`)
  process.exit(1)
}

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name} — ${detail}`) }
}

async function signIn(email) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'localdev123' }),
  })
  if (!res.ok) throw new Error(`sign-in ${email} → ${res.status}`)
  return (await res.json()).access_token
}

const H = (token, extra = {}) => ({
  apikey: ANON, Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json', Prefer: 'return=representation', ...extra,
})

async function rest(token, method, path, body) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method, headers: H(token), body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, code: json?.code ?? null, rows: Array.isArray(json) ? json : null }
}

async function main() {
  console.log(`probing ${URL_}\n`)

  const ofir = await signIn('ofir@local.test')     // plain waiter
  const dana = await signIn('dana@local.test')     // plain waiter
  const shift = await signIn('shift@local.test')   // shift manager → floor manager

  const staffRows = (await rest(SVC, 'GET', 'staff?select=id,email')).rows
  const idOf = (email) => staffRows.find((s) => s.email === email).id

  const table = (await rest(SVC, 'GET', 'waiter_tables?select=id,number,floor_id&number=eq.5')).rows[0]

  /* ── 1. Assignment: yourself only, stamped, releasable by anyone ──── */
  console.log('table assignment:')
  let r = await rest(ofir, 'PATCH', `waiter_tables?id=eq.${table.id}`, { held_by_staff_id: idOf('ofir@local.test') })
  check('waiter takes a table for themselves', r.ok && r.rows?.[0]?.held_by_staff_id === idOf('ofir@local.test'))
  check('held_since stamped by trigger', !!r.rows?.[0]?.held_since)

  // The rejection only triggers on a VALUE CHANGE — writing the value the
  // table already holds is a no-op the trigger rightly ignores. So test the
  // real rule on a different, free table: Dana pushing it onto Ofir.
  const freeTable = (await rest(SVC, 'GET', 'waiter_tables?select=id&number=eq.6')).rows[0]
  r = await rest(dana, 'PATCH', `waiter_tables?id=eq.${freeTable.id}`, { held_by_staff_id: idOf('ofir@local.test') })
  check('assigning a table to someone ELSE is rejected', r.code === '42501', `got ${r.code ?? r.status}`)

  r = await rest(dana, 'PATCH', `waiter_tables?id=eq.${table.id}`, { held_by_staff_id: idOf('dana@local.test') })
  check('takeover: another waiter reassigns to themselves', r.ok && r.rows?.[0]?.held_by_staff_id === idOf('dana@local.test'))

  r = await rest(ofir, 'PATCH', `waiter_tables?id=eq.${table.id}`, { held_by_staff_id: null })
  check('any staff can release a hold', r.ok && r.rows?.[0]?.held_by_staff_id === null && r.rows?.[0]?.held_since === null)

  /* ── 2. Labels + layout: floor managers only ──────────────────────── */
  console.log('\nOwners/VIP labels and layout:')
  r = await rest(ofir, 'PATCH', `waiter_tables?id=eq.${table.id}`, { label_kind: 'vip' })
  check('plain waiter cannot set a label', r.code === '42501', `got ${r.code ?? r.status}`)

  r = await rest(shift, 'PATCH', `waiter_tables?id=eq.${table.id}`, { label_kind: 'vip' })
  check('shift manager sets VIP', r.ok && r.rows?.[0]?.label_kind === 'vip')
  check('label_set_by stamped from session', r.rows?.[0]?.label_set_by === idOf('shift@local.test'))

  r = await rest(ofir, 'PATCH', `waiter_tables?id=eq.${table.id}`, { pos_x: 10 })
  check('plain waiter cannot move a table', r.code === '42501', `got ${r.code ?? r.status}`)
  r = await rest(shift, 'PATCH', `waiter_tables?id=eq.${table.id}`, { kind: 'booth', grid_w: 2 })
  check('shift manager edits kind/footprint', r.ok && r.rows?.[0]?.kind === 'booth' && r.rows?.[0]?.grid_w === 2)
  r = await rest(ofir, 'POST', 'waiter_tables', { number: 990 })
  check('plain waiter cannot add tables', r.code === '42501', `got ${r.code ?? r.status}`)

  // restore
  await rest(shift, 'PATCH', `waiter_tables?id=eq.${table.id}`, { label_kind: null, kind: 'regular', grid_w: 1, pos_x: 82.5 })

  /* ── 3. Floors + props ────────────────────────────────────────────── */
  console.log('\nfloors and props:')
  r = await rest(ofir, 'GET', 'waiter_floors?select=key,name_he&order=sort_order')
  check('waiter reads both floors', r.rows?.length === 2 && r.rows[0].key === 'inside', JSON.stringify(r.rows))

  r = await rest(ofir, 'POST', 'waiter_floor_props', { floor_id: table.floor_id, kind: 'plant', pos_x: 5, pos_y: 5 })
  check('plain waiter cannot place props', !r.ok, `got ${r.status}`)
  r = await rest(shift, 'POST', 'waiter_floor_props', { floor_id: table.floor_id, kind: 'hostess', pos_x: 50, pos_y: 2, grid_w: 2 })
  check('shift manager places the hostess bar', r.ok && r.rows?.[0]?.kind === 'hostess')
  const propId = r.rows?.[0]?.id
  if (propId) await rest(SVC, 'DELETE', `waiter_floor_props?id=eq.${propId}`)

  /* ── 4. Orders: identity is stamped, not supplied ─────────────────── */
  console.log('\norder identity:')
  r = await rest(ofir, 'POST', 'waiter_orders', {
    table_id: table.id, table_number: table.number, table_label: String(table.number),
    waiter_name: 'ZZZ-SPOOFED', status: 'open', total_agorot: 0,
  })
  const order = r.rows?.[0]
  check('order opens', !!order)
  check('waiter_staff_id stamped from session', order?.waiter_staff_id === idOf('ofir@local.test'))
  check('spoofed waiter_name overwritten from roster', order?.waiter_name === 'אופיר', `got "${order?.waiter_name}"`)

  /* ── 5. Guests: server-allocated seq ──────────────────────────────── */
  console.log('\nguests:')
  const g1 = await rest(ofir, 'POST', 'waiter_order_guests', { order_id: order.id, name: 'דנה הלקוחה' })
  const g2 = await rest(dana, 'POST', 'waiter_order_guests', { order_id: order.id })
  const g3 = await rest(ofir, 'POST', 'waiter_order_guests', { order_id: order.id })
  check('seq allocated 1,2,3 server-side',
    g1.rows?.[0]?.seq === 1 && g2.rows?.[0]?.seq === 2 && g3.rows?.[0]?.seq === 3,
    `got ${g1.rows?.[0]?.seq},${g2.rows?.[0]?.seq},${g3.rows?.[0]?.seq}`)
  check('anonymous guest has null name (rendered from seq)', g2.rows?.[0]?.name === null)
  check('added_by stamped from each session',
    g1.rows?.[0]?.added_by === idOf('ofir@local.test') && g2.rows?.[0]?.added_by === idOf('dana@local.test'))

  /* ── 6. Item lifecycle: registered by A, delivered by B ───────────── */
  console.log('\nitem lifecycle:')
  r = await rest(ofir, 'POST', 'waiter_order_items', {
    order_id: order.id, item_uid: 'wtyoqt7nlg', name_he: 'האש בראונס',
    unit_agorot: 4400, qty: 1, batch_no: 1,
    registered_by: idOf('dana@local.test'),          // ← spoof attempt
  })
  const item = r.rows?.[0]
  check('item registers with status=registered', item?.status === 'registered')
  check('spoofed registered_by overwritten to the session', item?.registered_by === idOf('ofir@local.test'))

  r = await rest(ofir, 'PATCH', `waiter_order_items?id=eq.${item.id}`, { status: 'sent' })
  check('filing → sent, sent_at stamped', r.rows?.[0]?.status === 'sent' && !!r.rows?.[0]?.sent_at)

  r = await rest(dana, 'PATCH', `waiter_order_items?id=eq.${item.id}`, { status: 'delivered' })
  check('ANOTHER waiter delivers', r.rows?.[0]?.status === 'delivered')
  check('delivered_by = the deliverer, not the registrar',
    r.rows?.[0]?.delivered_by === idOf('dana@local.test') && r.rows?.[0]?.registered_by === idOf('ofir@local.test'))
  check('delivered_at stamped', !!r.rows?.[0]?.delivered_at)

  r = await rest(ofir, 'PATCH', `waiter_order_items?id=eq.${item.id}`, { status: 'ready' })
  check('plain waiter cannot un-deliver', r.code === '42501', `got ${r.code ?? r.status}`)
  r = await rest(shift, 'PATCH', `waiter_order_items?id=eq.${item.id}`, { status: 'ready' })
  check('floor manager CAN correct a delivered item', r.ok && r.rows?.[0]?.status === 'ready')

  /* ── 7. Events: actor from session only ───────────────────────────── */
  console.log('\naudit events:')
  r = await rest(dana, 'POST', 'waiter_order_events', {
    order_id: order.id, event: 'item_delivered', actor: 'ZZZ-SPOOFED', payload: { probe: true },
  })
  check('event written', r.ok)
  check('spoofed actor overwritten from session',
    r.rows?.[0]?.actor === 'דנה' && r.rows?.[0]?.actor_staff_id === idOf('dana@local.test'),
    `got "${r.rows?.[0]?.actor}"`)
  r = await rest(dana, 'POST', 'waiter_order_events', { event: 'label_changed', table_id: table.id })
  check('table-scoped event without an order allowed', r.ok)
  r = await rest(dana, 'POST', 'waiter_order_events', { event: 'opened' })
  check('event with NO scope rejected', !r.ok)

  /* ── 8. Realtime publication membership ───────────────────────────── */
  console.log('\nrealtime:')
  const pub = execSync(
    `docker exec supabase_db_Portal_Website_and_Digital_Menu psql -U postgres -d postgres -t -A -c "select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename like 'waiter_%';"`,
    { encoding: 'utf8' }
  ).trim()
  check('7 waiter_* tables in the realtime publication', pub === '7', `got ${pub}`)

  /* ── teardown ─────────────────────────────────────────────────────── */
  await rest(SVC, 'DELETE', `waiter_orders?id=eq.${order.id}`)   // cascades items+guests
  await rest(SVC, 'DELETE', `waiter_order_events?payload->>probe=eq.true`)

  const total = pass + failures.length
  if (failures.length) { console.error(`\n✗ ${failures.length}/${total} failed`); process.exit(1) }
  console.log(`\n✓ workflow rules hold — ${pass}/${total} probes passed`)
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1) })
