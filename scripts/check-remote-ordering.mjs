#!/usr/bin/env node
// Logic + wiring harness for REMOTE ORDERING (2026-10-13; migration 058, PLAN_MENU_CART.md §12).
//
//   node scripts/check-remote-ordering.mjs
//
// Same shape and reasoning as check-cart.mjs: the rules are pure functions, so this runs the REAL TypeScript
// (transpiled on the fly), not a copy of it. It also does what a pure harness can about the parts that are not
// pure — reading the routes and components as text and holding them to what their headers promise — because the
// most valuable claims here are the structural ones ("the cookie is granted only after the database accepted a
// code", "the table comes from the session, never the body", "the push is never awaited inline").
//
// WHAT IT GUARDS
//   • the redeem input gate and the reason→HTTP mapping;
//   • every number in lib/cart/otp.ts against the SQL text of 048/058 (one rule spelled twice — the
//     lib/staff/access.ts ↔ is_op() lesson);
//   • THE OWNER'S PUSH RULE — "to the OMS if they are logged in there, else the portal" — exhaustively;
//   • that every customer-facing string exists in all three languages, in the right script;
//   • that "built but not enabled" is a property of the endpoints, not of a hidden button.
//
// What the database does (visits, recovery, caps, grants) is proved by check-migration-058.mjs.

import ts from 'typescript'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const outDir = join(tmpdir(), `ayeka-remote-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

function emit(rel, outName, rewrite = (s) => s) {
  const js = ts.transpileModule(read(rel), {
    fileName: outName.replace(/\.mjs$/, '.ts'),   // the .ts name picks the parser (see check-cart.mjs)
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
  writeFileSync(join(outDir, outName), rewrite(js))
}
const rel = (js) => js.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
emit('src/lib/cart/otp.ts', 'otp.mjs', rel)
emit('src/lib/cart/remote.ts', 'remote.mjs', rel)
emit('src/lib/push/orders-rules.ts', 'orders-rules.mjs')
emit('src/lib/waiter/calls.ts', 'calls.mjs', rel)
const load = (name) => import(pathToFileURL(join(outDir, name)).href)
const Otp = await load('otp.mjs')
const R = await load('remote.mjs')
const P = await load('orders-rules.mjs')
const C = await load('calls.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const LANGS = ['he', 'en', 'ar']
const HEBREW = /[֐-׿]/, ARABIC = /[؀-ۿ]/, LATIN = /[A-Za-z]/

// Comments blanked, so a rule is checked against CODE and a comment that merely mentions it cannot satisfy it.
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1')
const code = (p) => strip(read(p))

// ───────────────────────────────────────────────────────────────────────────
section('otp.ts ↔ the SQL — every number is spelled twice, and has to be the same number')
{
  const m058 = read('supabase/migrations/058_remote_ordering.sql')
  const m048 = read('supabase/migrations/048_customer_table_ordering_groundwork.sql')
  const types = read('src/lib/cart/types.ts')
  const maxLines = Number(types.match(/MAX_LINES\s*=\s*(\d+)/)?.[1])
  const has = (re) => re.test(m058)
  check('the digits regex in redeem_table_code is exactly TABLE_CODE_LENGTH wide', has(new RegExp(`\\^\\[0-9\\]\\{${Otp.TABLE_CODE_LENGTH}\\}\\$`)))
  check('the first-use deadline is TABLE_CODE_TTL_SECONDS (issue + rotate)',
    (m058.match(new RegExp(`make_interval\\(secs => ${Otp.TABLE_CODE_TTL_SECONDS}\\)`, 'g')) ?? []).length >= 3)
  check('the visit is TABLE_SESSION_TTL_SECONDS long', has(new RegExp(`make_interval\\(secs => ${Otp.TABLE_SESSION_TTL_SECONDS}\\)`)))
  check('the device cap is TABLE_VISIT_MAX_DEVICES', has(new RegExp(`v_devices >= ${Otp.TABLE_VISIT_MAX_DEVICES}\\b`)))
  check('the pending cap is VISIT_MAX_PENDING', has(new RegExp(`v_pending >= ${Otp.VISIT_MAX_PENDING}\\b`)))
  check('the gap between sends is SUBMISSION_MIN_GAP_SECONDS', has(new RegExp(`interval '${Otp.SUBMISSION_MIN_GAP_SECONDS} seconds'`)))
  check('a pending request stays on the list for SUBMISSION_OPEN_WINDOW_MINUTES',
    has(new RegExp(`created_at > now\\(\\) - interval '${Otp.SUBMISSION_OPEN_WINDOW_MINUTES / 60} hours'`)))
  check('the line cap in create_cart_submission is MAX_LINES', Number.isInteger(maxLines) && has(new RegExp(`p_item_count > ${maxLines}\\b`)), `types.ts says ${maxLines}`)
  check('the retired attempt-burn is really gone from redemption (no `v_row.attempts + 1 > 5`)', !/attempts \+ 1 > 5/.test(m058.slice(m058.indexOf('function public.redeem_table_code'))))
  check('048 had the old numbers this replaces (so the pins above are not vacuous)', /make_interval\(secs => 10800\)/.test(m048) && /attempts \+ 1 > 5/.test(m048))
  check('the cookie is httpOnly-by-name: TABLE_SESSION_COOKIE is the declared name', Otp.TABLE_SESSION_COOKIE === 'ayeka_table_session')
  check('the retired constant is not exported any more', Otp.TABLE_CODE_MAX_ATTEMPTS === undefined)
  check('the global failure counter and the per-IP limit still exist (049 requires both)',
    Otp.TABLE_CODE_GLOBAL_FAIL_MAX > 0 && Otp.TABLE_CODE_RATE_MAX > 0 && Otp.TABLE_CODE_GLOBAL_FAIL_MAX > Otp.TABLE_CODE_RATE_MAX)
}

// ───────────────────────────────────────────────────────────────────────────
section('validateRedeemInput — the gate in front of the database and the failure counter')
{
  const ok = (v) => R.validateRedeemInput(v)
  check('six digits pass', ok({ code: '123456' }).ok === true && ok({ code: '123456' }).code === '123456')
  check('a code read aloud in threes ("123 456") passes, normalised', ok({ code: '123 456' }).code === '123456')
  check('a pasted label ("קוד: 123456") passes, normalised', ok({ code: 'קוד: 123456' }).code === '123456')
  check('a dash or an RTL mark does not matter', ok({ code: '123-456' }).code === '123456' && ok({ code: '‏123456‏' }).code === '123456')
  check('leading zeros survive (a code is a string, not a number)', ok({ code: '000123' }).code === '000123')
  check('five digits → bad_code (never reaches the database)', ok({ code: '12345' }).error === 'bad_code')
  check('letters only → bad_code', ok({ code: 'abcdef' }).error === 'bad_code')
  check('seven digits are cut to six (a fat-fingered extra digit is forgiven)', ok({ code: '1234567' }).code === '123456')
  check('an empty string → bad_request', ok({ code: '' }).error === 'bad_request')
  check('a 41-character string → bad_request (a ceiling, not a parser)', ok({ code: '1'.repeat(41) }).error === 'bad_request')
  check('a number instead of a string → bad_request', ok({ code: 123456 }).error === 'bad_request')
  check('no code → bad_request', ok({}).error === 'bad_request')
  for (const [name, v] of [['null', null], ['undefined', undefined], ['an array', ['123456']], ['a string', '123456'], ['a number', 7]]) {
    check(`${name} → bad_request`, ok(v).ok === false && ok(v).error === 'bad_request')
  }
  check('extra fields are ignored, not trusted (a table number in the body changes nothing)', ok({ code: '123456', tableNumber: 99, table_id: 'x' }).code === '123456'
    && !('tableNumber' in ok({ code: '123456', tableNumber: 99 })))
}

section('session tokens and reasons')
{
  const hex = 'a1'.repeat(32)
  check('a 64-char lowercase hex token is valid', R.isValidSessionToken(hex))
  check('UPPERCASE hex is not (the SQL regex is lowercase — the two must agree)', !R.isValidSessionToken(hex.toUpperCase()))
  check('63 / 65 chars are not', !R.isValidSessionToken(hex.slice(1)) && !R.isValidSessionToken(hex + 'a'))
  check('non-hex, empty, undefined, number are not', !R.isValidSessionToken('z'.repeat(64)) && !R.isValidSessionToken('') && !R.isValidSessionToken(undefined) && !R.isValidSessionToken(5))
  for (const reason of ['bad_code', 'expired', 'too_many_devices', 'no_session', 'ended', 'no_shift', 'too_many_pending', 'too_fast', 'bad_request']) {
    check(`the database's "${reason}" maps to itself`, R.remoteErrorFromReason(reason) === reason)
  }
  check('anything unrecognised is a server error, never a pass', R.remoteErrorFromReason('banana') === 'server' && R.remoteErrorFromReason(null) === 'server' && R.remoteErrorFromReason(undefined) === 'server' && R.remoteErrorFromReason('') === 'server')
  const codes = Object.keys(R.REMOTE_ERROR_STATUS)
  check('every error code has an HTTP status that is an error', codes.every((c) => R.REMOTE_ERROR_STATUS[c] >= 400 && R.REMOTE_ERROR_STATUS[c] < 600))
  check('every error code has a message', codes.every((c) => R.REMOTE_UI.errors[c]), codes.filter((c) => !R.REMOTE_UI.errors[c]).join(', '))
  check('…and there is no message for a code that does not exist', Object.keys(R.REMOTE_UI.errors).every((c) => codes.includes(c)))
  check('the reasons the SQL can return are all covered by an error code',
    ['bad_code', 'expired', 'too_many_devices', 'no_session', 'ended', 'no_shift', 'too_many_pending', 'too_fast', 'bad_request']
      .every((r) => codes.includes(r) && read('supabase/migrations/058_remote_ordering.sql').includes(`'${r}'`)))
  check('an unknown code shows the generic message, in the language asked', R.remoteErrorText('???', 'en') === R.REMOTE_UI.errors.server.en && R.remoteErrorText(undefined, 'ar') === R.REMOTE_UI.errors.server.ar)
}

section('sanitizeSent — the client does not get to assume the route\'s answer is well-formed')
{
  const good = { id: 'a', status: 'pending', itemCount: 3, totalAgorot: 5000, createdAt: '2026-10-13T20:00:00Z' }
  check('a well-formed row passes through', R.sanitizeSent([good]).length === 1 && R.sanitizeSent([good])[0].itemCount === 3)
  check('a non-array is an empty list', R.sanitizeSent(null).length === 0 && R.sanitizeSent({}).length === 0 && R.sanitizeSent('x').length === 0)
  check('an unknown status is dropped (it would index a label that does not exist)', R.sanitizeSent([{ ...good, status: 'approved' }]).length === 0)
  check('a missing id / createdAt is dropped', R.sanitizeSent([{ ...good, id: 5 }]).length === 0 && R.sanitizeSent([{ ...good, createdAt: undefined }]).length === 0)
  check('NaN counts are dropped', R.sanitizeSent([{ ...good, itemCount: 'x' }]).length === 0)
  check('null and non-objects are dropped without throwing', R.sanitizeSent([null, 5, 'x', good]).length === 1)
  check('at most 20 are kept', R.sanitizeSent(Array.from({ length: 50 }, () => good)).length === 20)
  check('every state the database can store has a label', ['pending', 'imported', 'rejected', 'expired'].every((s) => LANGS.every((l) => R.REMOTE_UI.state[s]?.[l])))
  check('…and those are exactly the states 048 allows', ['pending', 'imported', 'rejected', 'expired'].every((s) => read('supabase/migrations/048_customer_table_ordering_groundwork.sql').includes(`'${s}'`)))
}

section('words — all three languages, in the right script')
{
  const leaves = []
  const walk = (o, path) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !('he' in v && 'en' in v && 'ar' in v)) walk(v, `${path}.${k}`); else leaves.push([`${path}.${k}`, v]) } }
  walk(R.REMOTE_UI, 'REMOTE_UI')
  check(`all ${leaves.length} strings are trilingual and non-empty`, leaves.every(([, v]) => LANGS.every((l) => typeof v[l] === 'string' && v[l].trim().length > 0)),
    leaves.filter(([, v]) => !LANGS.every((l) => typeof v[l] === 'string' && v[l].trim())).map(([k]) => k).join(', '))
  check('he is Hebrew, en is Latin, ar is Arabic — no language holds another\'s script', leaves.every(([, v]) =>
    HEBREW.test(v.he) && !ARABIC.test(v.he) && LATIN.test(v.en) && !HEBREW.test(v.en) && !ARABIC.test(v.en) && ARABIC.test(v.ar) && !HEBREW.test(v.ar)),
    leaves.filter(([, v]) => !(HEBREW.test(v.he) && LATIN.test(v.en) && ARABIC.test(v.ar))).map(([k]) => k).join(', '))
  check('no stray double spaces or edge spaces', leaves.every(([, v]) => LANGS.every((l) => v[l] === v[l].trim() && !/\s{2,}/.test(v[l]))))
  check('the {n} placeholder is in every language of the strings that use it', ['connectedAs', 'items'].every((k) => LANGS.every((l) => R.REMOTE_UI[k][l].includes('{n}'))))
  check('…and interpolation (not concatenation) puts the number in', R.connectedText(12, 'he').includes('12') && !R.connectedText(12, 'en').includes('{n}') && R.itemsText(4, 'ar').includes('4'))
  check('the cart\'s own strings gained the two honest-note variants (and they are trilingual)',
    ['soonHintCall', 'localOnlyUntilSent', 'tutorialPrivacyUntilSent'].every((k) => new RegExp(`${k}:\\s*\\{[^}]*he:[^}]*en:[^}]*ar:`).test(read('src/lib/cart/i18n.ts'))))
}

// ───────────────────────────────────────────────────────────────────────────
section('THE OWNER\'S PUSH RULE — "to the OMS if they are logged in there, otherwise the portal"')
{
  const NOW = Date.parse('2026-10-13T20:00:00Z')
  const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString()
  const sub = (id, app, h) => ({ id, staff_id: 's', endpoint: `https://p/${id}`, p256dh: 'x', auth: 'y', app, last_seen_at: hoursAgo(h) })
  const ids = (xs) => xs.map((x) => x.id).sort().join(',')
  const T = (subs) => P.chooseTargets(subs, NOW)

  let t = T([sub('oms1', 'oms', 1), sub('web1', 'portal', 1)])
  check('BOTH logged in → the OMS gets it, and only the OMS', ids(t.primary) === 'oms1')
  check('…the portal is held back as the fallback, not buzzed in parallel (no double buzz on one phone)', ids(t.fallback) === 'web1')
  t = T([sub('oms1', 'oms', 1)])
  check('only the OMS → the OMS, no fallback', ids(t.primary) === 'oms1' && t.fallback.length === 0)
  t = T([sub('web1', 'portal', 1)])
  check('only the portal → the portal', ids(t.primary) === 'web1' && t.fallback.length === 0)
  t = T([sub('oms1', 'oms', 30), sub('web1', 'portal', 1)])
  check('the OMS subscription is STALE (30h) → the portal wins (last week\'s tablet must not swallow tonight\'s alert)', ids(t.primary) === 'web1' && t.fallback.length === 0)
  t = T([sub('oms1', 'oms', 30)])
  check('only a stale OMS one → still tried (better than telling nobody)', ids(t.primary) === 'oms1')
  check('nothing at all → nobody, without throwing', T([]).primary.length === 0 && T([]).fallback.length === 0)
  t = T([sub('omsA', 'oms', 2), sub('omsB', 'oms', 40), sub('web1', 'portal', 1)])
  check('two POS devices, one fresh and one stale → only the fresh one', ids(t.primary) === 'omsA')
  t = T([sub('omsA', 'oms', 2), sub('omsB', 'oms', 3)])
  check('two FRESH POS devices (a shared tablet and a phone) → both', ids(t.primary) === 'omsA,omsB')
  t = T([sub('web1', 'portal', 500), sub('web2', 'portal', 1)])
  check('portal subscriptions are never "stale" — last_seen only means something for the POS', ids(t.primary) === 'web1,web2')
  t = T([sub('oms24', 'oms', 24), sub('web1', 'portal', 1)])
  check('exactly 24 hours old is still fresh (the boundary is inclusive)', ids(t.primary) === 'oms24')
  t = T([{ ...sub('oms', 'oms', 0), last_seen_at: new Date(NOW - 24 * 3600_000 - 1).toISOString() }, sub('web1', 'portal', 1)])
  check('one millisecond past 24 hours is stale', ids(t.primary) === 'web1')
  t = T([{ ...sub('oms', 'oms', 0), last_seen_at: 'not a date' }, sub('web1', 'portal', 1)])
  check('an unparseable last_seen_at is stale, never "fresh by accident" (NaN fails every comparison)', ids(t.primary) === 'web1')
  t = T([sub('oms1', 'oms', 0), sub('web1', 'portal', 0), sub('web2', 'portal', 0)])
  check('the fallback carries ALL of the person\'s portal devices', ids(t.fallback) === 'web1,web2')
  check('the freshness window is 24h (the number the SQL comment and PLAN promise)', P.OMS_PUSH_FRESH_HOURS === 24)
  check('the rule is TypeScript-only: no SQL decides OMS-vs-portal (nothing to drift)', !/oms_push_fresh|fresh_hours/i.test(read('supabase/migrations/058_remote_ordering.sql').replace(/--[^\n]*/g, '')))
}

section('the notification itself')
{
  const a = { submissionId: 'sub-1', tableNumber: 12, itemCount: 4, totalAgorot: 12500 }
  const o = P.buildOrderPayload(a, 'oms'), w = P.buildOrderPayload(a, 'portal')
  check('the title names the table', o.title.includes('12') && HEBREW.test(o.title))
  check('the body carries the quantity and the total in shekels, and says it waits for approval', o.body.includes('4') && o.body.includes('125') && o.body.includes('ממתין'))
  check('a fractional total keeps two decimals; a whole one has none', P.buildOrderPayload({ ...a, totalAgorot: 1250 }, 'oms').body.includes('12.50') && P.buildOrderPayload({ ...a, totalAgorot: 1200 }, 'oms').body.includes('₪12 '))
  check('a negative total cannot print a negative price', !P.buildOrderPayload({ ...a, totalAgorot: -500 }, 'oms').body.includes('-'))
  check('an unknown table prints "?" rather than "null"', P.buildOrderPayload({ ...a, tableNumber: null }, 'oms').title.includes('?') && !P.buildOrderPayload({ ...a, tableNumber: null }, 'oms').title.includes('null'))
  check('the POS opens its own home; the portal opens the staff dashboard', o.url === '/' && w.url === '/staff/dashboard')
  check('both URLs are same-origin PATHS (a notification can never send a tap to another site)', [o.url, w.url].every((u) => /^\/(?!\/)/.test(u)))
  check('the tag is per request, so a repeat replaces instead of stacking, and two requests never collide', o.tag === 'table-order-sub-1' && P.buildOrderPayload({ ...a, submissionId: 'sub-2' }, 'oms').tag !== o.tag)
  check('it vibrates and stays on screen until dealt with (urgent)', o.urgent === true && o.vibrate.length >= 3 && o.vibrate.every(Number.isFinite))
  check('the vibration array is a COPY — mutating one alert cannot change the next', (() => { o.vibrate.push(1); return P.buildOrderPayload(a, 'oms').vibrate.length === P.ORDER_VIBRATION.length })())
  check('kind is "table-order" (the service worker and the open page key off it)', o.kind === 'table-order' && w.kind === 'table-order')
  check('the push service drops an order request after 15 minutes (stale news is worse than none)', P.ORDER_PUSH_TTL_SECONDS === 900)
  check('the alert carries NO customer data — no name, no note, no item names', !/payload|name|note|diner/i.test(JSON.stringify(Object.keys(o))))
}

// ───────────────────────────────────────────────────────────────────────────
section('"built but not enabled" is a property of the ENDPOINTS, not of a hidden button')
{
  const sess = code('src/app/api/table/session/route.ts')
  const order = code('src/app/api/table/order/route.ts')
  const keys = code('src/lib/settings/keys.ts')
  const idx = (s, re) => { const m = s.search(re); return m < 0 ? Infinity : m }

  check('the switch ships OFF (fails closed)', /TABLE_ORDERING_ENABLED_DEFAULT\s*=\s*false/.test(keys))
  check('the migration seeds it as an explicit false row', /'table_ordering_enabled',\s*'false'::jsonb/.test(read('supabase/migrations/048_customer_table_ordering_groundwork.sql')))
  check('redeem refuses when the switch is off — BEFORE any rate-limit write or database call',
    idx(sess.slice(sess.indexOf('export async function POST')), /orderingEnabled\(\)/) < idx(sess.slice(sess.indexOf('export async function POST')), /checkRateLimit\(|\.rpc\(/))
  check('sending refuses when the switch is off — BEFORE reading the session or the database',
    idx(order, /orderingEnabled\(\)/) < idx(order, /readSessionToken\(|\.rpc\(/))
  check('GET /api/table/session says "not connected" when the switch is off, without asking the database',
    /!token \|\| !\(await orderingEnabled\(\)\)/.test(sess))
  check('the customer-facing button needs BOTH locks: the switch AND the build constant', /orderLive = actions\.ordering && PHASE_2_BUILT/.test(code('src/components/cart/CartSheet.tsx')))
  check('the order sheet is not even MOUNTED while the switch is off', /\{orderLive && \(\s*<TableOrderSheet/.test(code('src/components/cart/CartSheet.tsx')))
  check('the build constant lives in ONE place and CartSheet does not redefine it', /export const PHASE_2_BUILT: boolean = true/.test(code('src/lib/cart/phases.ts')) && !/const PHASE_2_BUILT/.test(code('src/components/cart/CartSheet.tsx')))
  check('the tutorial\'s privacy sentence follows the same two locks', /actions\.ordering && PHASE_2_BUILT/.test(code('src/components/cart/CartTutorial.tsx')))
}

section('the session route\'s guard rails (049\'s two requirements, and the cookie rules)')
{
  const post = code('src/app/api/table/session/route.ts')
  const body = post.slice(post.indexOf('export async function POST'), post.indexOf('export async function GET'))
  const idx = (re) => { const m = body.search(re); return m < 0 ? Infinity : m }
  check('order of rails: origin/JSON → switch → validation → per-IP → global failures → the RPC',
    idx(/sameOriginJson/) < idx(/orderingEnabled/) && idx(/orderingEnabled/) < idx(/validateRedeemInput/) &&
    idx(/validateRedeemInput/) < idx(/checkRateLimit\(`table-redeem:/) && idx(/checkRateLimit\(`table-redeem:/) < idx(/peekRateLimitExceeded/) &&
    idx(/peekRateLimitExceeded/) < idx(/\.rpc\('redeem_table_code'/))
  check('a malformed code never reaches the failure counter or the database (validation is before both)', idx(/validateRedeemInput/) < idx(/checkRateLimit/))
  check('the per-IP limit is the declared one (TABLE_CODE_RATE_MAX / _WINDOW_SECONDS)', /TABLE_CODE_RATE_MAX, TABLE_CODE_RATE_WINDOW_SECONDS/.test(body))
  check('the GLOBAL failure counter is PEEKED before the guess is evaluated', /peekRateLimitExceeded\('table-redeem-fail:global', TABLE_CODE_GLOBAL_FAIL_MAX, TABLE_CODE_GLOBAL_FAIL_WINDOW_SECONDS\)/.test(body))
  check('…and a wrong guess (only a wrong guess) is RECORDED against it', /if \(code === 'bad_code'\) \{\s*await checkRateLimit\('table-redeem-fail:global'/.test(body)
    && (body.match(/'table-redeem-fail:global'/g) ?? []).length === 2)
  check('the cookie is granted only after the database accepted the code', body.indexOf('cookies.set(TABLE_SESSION_COOKIE, row.session_token') > body.indexOf('if (!row.ok)'))
  check('the cookie expires WITH the visit (the database\'s expires_at), not a fresh three hours each time', /expires = new Date\(row\.expires_at\)/.test(body) && /cookieOptions\(expires\)/.test(body))
  check('only the REASON is returned on failure, never whether a code exists', !/row\.(table_number|session_token)/.test(body.slice(body.indexOf('if (!row.ok)'), body.indexOf('if (typeof row.session_token'))))
  check('Secure in production only, so a localhost dev server can still test it', /secure: process\.env\.NODE_ENV === 'production'/.test(post))
  check('every response is no-store (a session answer must never be cached)', (post.match(/no-store/g) ?? []).length >= 1 && /noStore/.test(body))
  check('the body ceiling is tiny (a code is six digits)', Number(post.match(/MAX_BODY_BYTES = (\d+)/)?.[1]) <= 512)
  const get = post.slice(post.indexOf('export async function GET'), post.indexOf('export async function DELETE'))
  check('GET: no cookie → not connected, and the database is not asked', get.indexOf('readSessionToken') < get.indexOf('.rpc(') && /connected: false/.test(get.slice(0, get.indexOf('.rpc('))))
  check('GET: a dead session tells the browser to drop its dead cookie', /connected: false[\s\S]*?cookies\.set\(TABLE_SESSION_COOKIE, ''[\s\S]*?maxAge: 0/.test(get.slice(get.indexOf('!s?.ok'))))
  check('GET returns the visit\'s requests as status + counts — no payload, no names', !/payload/.test(get) && /table_session_submissions/.test(get))
  const del = post.slice(post.indexOf('export async function DELETE'))
  check('DELETE signs out THIS phone only (the visit and the other phones carry on)', /revoked_at/.test(del) && /\.eq\('token_hash', hashToken\(token\)\)/.test(del) && !/waiter_table_codes/.test(del))
  check('DELETE needs no JSON body, only the origin check (a same-origin DELETE has no content-type)', /sameOriginOnly/.test(del) && !/sameOriginJson/.test(del))
}

section('the order route — the table comes from the SESSION, and the push never blocks a send')
{
  const orderFile = code('src/app/api/table/order/route.ts')
  // The handler only — the import line names every one of these first and would satisfy any ordering.
  const order = orderFile.slice(orderFile.indexOf('export async function POST'))
  const idx = (re) => { const m = order.search(re); return m < 0 ? Infinity : m }
  check('order of rails: origin/JSON → switch → session → rate limits → validation → the RPC',
    idx(/sameOriginJson/) < idx(/orderingEnabled/) && idx(/orderingEnabled/) < idx(/readSessionToken/) && idx(/readSessionToken/) < idx(/checkRateLimit/) &&
    idx(/checkRateLimit/) < idx(/validateSubmission/) && idx(/validateSubmission/) < idx(/\.rpc\('create_cart_submission'/))
  check('no session cookie → refused before anything else is spent', /if \(!token\) return refuse\('no_session'\)/.test(order))
  check('the table is NEVER read from the request: the RPC is handed the token and the validated payload only',
    // (the one legitimate mention: the alert's label is whatever the DATABASE answered for the session's table)
    // (and the push reads the table id back from the ROW the database just stored — never from the body)
    /p_token: token,\s*p_payload: submission,/.test(order) &&
    !/tableNumber|table_id|table_number|searchParams|nextUrl/.test(
      order.replace(/tableNumber: row\.table_number \?\? null/, '').replace(/table_number\?: number \| null/, '').replace(/row\.table_number/g, '')
        .replace(/\.select\('table_id'\)/, '').replace(/\(data as \{ table_id\?: string \| null \} \| null\)\?\.table_id/, '')))
  check('what is stored is validateSubmission\'s RETURN VALUE, never the caller\'s object', /submission = validated\.value/.test(order) && /p_payload: submission/.test(order))
  check('the line count and the total sent to the database are the RECOMPUTED ones', /p_item_count: submission\.items\.length/.test(order) && /p_total: submission\.total_agorot/.test(order))
  check('the push runs AFTER the response, never awaited inline (a slow push service cannot slow or fail a send)', /afterResponse\(async \(\) => \{[\s\S]*?await notifyStaffOfSubmission\(/.test(order)
    // (the only `await` is INSIDE the after-response task; the handler itself never waits for the push)
    && !/await notifyStaffOfSubmission/.test(order.replace(/afterResponse\(async \(\) => \{[\s\S]*?\n      \}\)/, '')))
  check('the push alert uses QUANTITY (4 drinks), not line count', /reduce\(\(n, i\) => n \+ i\.qty, 0\)/.test(order))
  check('nothing about the new row is echoed back (not even its id)', /NextResponse\.json\(\{ ok: true \}/.test(order) && !/submission_id/.test(order.slice(order.indexOf('NextResponse.json({ ok: true }'))))
  check('"empty" is decided by shape, not by matching the validator\'s Hebrew wording', /items\.length === 0\) return refuse\('empty'\)/.test(order) && !/ההזמנה ריקה/.test(order))
  check('the body ceiling is 64 KB (the SQL refuses a payload over 65536 bytes, so a bigger body is never read)', /MAX_BODY_BYTES = 64 \* 1024/.test(orderFile) && /octet_length\(p_payload::text\) > 65536/.test(read('supabase/migrations/058_remote_ordering.sql')))
}

section('the server helpers and the push sender')
{
  const h = code('src/lib/server/table-session.ts')
  check('the session token is read from the cookie and VALIDATED before any database call', /isValidSessionToken\(value\)/.test(h))
  check('the origin guard refuses a mismatched Origin and accepts no Origin (not a cross-site browser request)', /originHost !== host/.test(h))
  check('the JSON guard reads the size from the header before the body is read', /content-length/.test(h) && /declared > maxBytes/.test(h))
  check('hashToken is SHA-256 hex — what the SQL stores', /createHash\('sha256'\)/.test(h) && /digest\('hex'\)/.test(h))
  check('NO cookie is written from the helper (the session route is the only writer)', !/cookies\.set/.test(h))

  const o = code('src/lib/push/orders.ts')
  check('who is told comes from the DATABASE rule (waiter_call_recipient_staff_ids), not a list in code', /rpc\('waiter_call_recipient_staff_ids'\)/.test(o))
  check('the choice of device is the pure rule', /chooseTargets\(subs, now\)/.test(o))
  check('the fallback is tried ONLY when the preferred devices all failed', /if \(delivered === 0 && fallback\.length > 0\)/.test(o))
  check('it never throws (a push problem must not fail a customer\'s send)', /catch \(err\)[\s\S]*return \{ delivered: 0, escalated: false \}/.test(o) && /ensureVapidConfigured\(\)\) return/.test(o))
  check('the TABLE\'S WAITER is asked of the database (waiter_table_holder) and told first', /rpc\('waiter_table_holder'/.test(o) && /pushToPeople\(service, \[holder\], alert\.build\)/.test(o))
  check('…the shift is told only when nobody holds the table or the waiter\'s devices could not be reached', /if \(!holder \|\| delivered === 0\)/.test(o))
  check('…and a heads-up only for the waiter (a customer connecting) never wakes the shift', /if \(alert\.holderOnly\) return/.test(o) && /holderOnly: true/.test(o))
  check('ESCALATION: after ESCALATION_SECONDS, if it is STILL waiting, the rest of the shift is told ("who is free?")',
    /await sleep\(ESCALATION_SECONDS \* 1000\)/.test(o) && /stillWaiting\(\)/.test(o) && /escalated\(alert\.build\(app\), ESCALATION_SECONDS\)/.test(o) && /everyone\.filter\(\(id\) => id !== holder\)/.test(o))
  check('…"still waiting" is read from the database: an order is `pending`, a call is not acknowledged', /status === 'pending'/.test(o) && /acknowledged_at == null/.test(o))
  check('…and a request nobody was told about first never escalates (that path already told everyone)', /if \(!alert\.stillWaiting\) return/.test(o))
  check('delivery goes through the SHARED routine that prunes dead subscriptions (404/410)', /from '\.\/deliver'/.test(o) && /404 \|\| statusCode === 410/.test(code('src/lib/push/deliver.ts')))
  check('…with the short order TTL, not the three-hour schedule one', /ttlSeconds: ORDER_PUSH_TTL_SECONDS/.test(o))
  check('the SCHEDULE alerts still deliver through the same routine, unchanged', /from '\.\/deliver'/.test(code('src/lib/push/staff.ts')) && /sendToOne\(service, device, payload\)/.test(code('src/lib/push/staff.ts')))
}

section('the staff-side card and the service worker')
{
  const api = code('src/app/api/staff/orders/route.ts')
  check('the card\'s API asks the database AS THE USER (so the recipient rule sees a real caller), behind requireStaff', /requireStaff\(\)/.test(api) && /createClient\(\)\.rpc\('waiter_pending_submissions'\)/.test(api) && !/createServiceClient/.test(api))
  check('it returns counts, the table and the time — never the payload', !/payload:/.test(api.slice(api.indexOf('NextResponse.json'))) && /orders = \(/.test(api))
  check('an unapplied migration is an empty list, not an error', /if \(error\) return NextResponse\.json\(\{ orders: \[\] \}/.test(api))
  const card = code('src/components/staff/PendingRemoteOrders.tsx')
  check('the card renders nothing when nothing is waiting (a signal renders only when it is true)', /if \(orders\.length === 0\) return null/.test(card))
  check('the first answer is quiet; only a NEW order dings', /known\.current !== null && fresh\.length > 0/.test(card))
  check('the card refreshes the moment the service worker reports a push', /type === 'staff-alert'/.test(card))
  check('the staff dashboard mounts the card', /<PendingRemoteOrders \/>/.test(code('src/app/staff/dashboard/page.tsx')))

  const sw = read('public/sw.js')
  check('a plain schedule alert is untouched: no vibrate, no requireInteraction unless the payload asks', /if \(Array\.isArray\(data\.vibrate\)\)/.test(sw) && /if \(data\.urgent === true\)/.test(sw))
  check('the vibration pattern is validated as data (numbers, clamped, at most 9)', /typeof n === 'number' && Number\.isFinite\(n\)/.test(sw) && /slice\(0, 9\)/.test(sw) && /Math\.min\(2000/.test(sw))
  check('renotify is only set WITH a tag (it throws without one)', /typeof data\.tag === 'string' && data\.tag\.length > 0\) options\.renotify = true/.test(sw))
  check('an open page is told an alert arrived', /client\.postMessage\(\{ type: 'staff-alert'/.test(sw))
  check('a tap still opens only a same-origin staff path', /\|\| '\/staff'/.test(sw))

  const flags = code('src/app/api/owner/dev/flags/route.ts')
  check('the dev flags route is the DEVELOPER\'s (requireDev) for both verbs, and PATCH takes exactly one real boolean', (flags.match(/requireDev\(\)/g) ?? []).length === 2 && /wantsCall === wantsOrdering/.test(flags) && /typeof body\?\.waiterCallEnabled === 'boolean'/.test(flags))
  // The general manager's route may READ the two switches (to show them) but may only WRITE the cart's own.
  const mc = code('src/app/api/owner/menu-cart/route.ts')
  const mcPatch = mc.slice(mc.indexOf('export async function PATCH'))
  check('the menu editor\'s route can WRITE only the cart switch — the general manager cannot turn ordering or the call on',
    /key: MENU_CART_ENABLED,/.test(mcPatch) && !/TABLE_ORDERING_ENABLED|WAITER_CALL_ENABLED|tableOrdering|waiterCall/.test(mcPatch) &&
    /typeof body\.menuCartEnabled !== 'boolean'/.test(mcPatch))
}

section('the twin: ding.ts in both repos is one file')
{
  const posPath = join(ROOT, '..', 'ayeka-staff', 'src', 'ding.ts')
  if (existsSync(posPath)) {
    const a = read('src/lib/staff/ding.ts'), b = readFileSync(posPath, 'utf8')
    check('ayeka-staff/src/ding.ts is byte-identical to lib/staff/ding.ts', a === b)
  } else {
    console.log('  – ayeka-staff is not next to this repo here; the twin check is skipped')
  }
  const ding = read('src/lib/staff/ding.ts')
  const pat = ding.match(/pattern: number\[\] = \[([\d, ]+)\]/)?.[1].replace(/\s/g, '')
  check('buzz()\'s default pattern is the one the push notification asks the phone for (ORDER_VIBRATION)', pat === P.ORDER_VIBRATION.join(','), `${pat} vs ${P.ORDER_VIBRATION.join(',')}`)
  check('the sound stores nothing (no localStorage / cookie)', !/localStorage|sessionStorage|document\.cookie/.test(strip(ding)))
}

// ───────────────────────────────────────────────────────────────────────────
// 2026-10-15 — table ownership (migration 061), calls without a typed table, push for every customer event, floor pings.
section('061 — the table\'s waiter, the escalation and the feed (the numbers and the words)')
{
  const m061 = read('supabase/migrations/061_table_ownership_and_alerts.sql')
  check('ESCALATION_SECONDS is the SQL\'s 90 (the other waiters SEE a request at the same moment they are PUSHED it)', P.ESCALATION_SECONDS === 90 && /make_interval\(secs => 90\)/.test(m061))
  check('the SQL names the table\'s waiter first, then management, then the roster rule (in that order)',
    m061.indexOf('-- 1. the table\'s own waiter') < m061.indexOf('-- 2. management oversight') && m061.indexOf('-- 2. management oversight') < m061.indexOf('-- 3. everyone else'))
  check('the SQL\'s management titles are the call rule\'s minus "waiter" (owner / general manager / shift manager / dev)',
    /v_staff\.badge in \('owner', 'general_manager', 'manager'\)/.test(m061) && /lower\(coalesce\(v_staff\.badge, ''\)\) = 'dev'/.test(m061) && /v_staff\.role = 'owner'/.test(m061))
  check('the two helpers that take ANY staff id are not executable by signed-in users (they would be an "is X on shift" oracle)',
    /revoke execute on function public\.waiter_staff_can_handle_table\(uuid, uuid, timestamptz\) from public, anon, authenticated;/.test(m061) && !/grant\s+execute on function public\.waiter_staff_can_handle_table/.test(m061))
  check('every customer-facing function of 061 is granted to nobody (service role only)',
    ['table_session_waiter(text)', 'create_table_call(integer, text, integer, integer)', 'create_table_call_for_session(text, text, integer, integer)', 'waiter_table_holder(uuid)']
      .every((f) => new RegExp(`revoke execute on function public\\.${f.replace(/[()]/g, '\\$&')} from public, anon, authenticated;`).test(m061)
        && !new RegExp(`grant\\s+execute on function public\\.${f.replace(/[()]/g, '\\$&')}`).test(m061)))
  check('the feed triggers can never lose a customer\'s order, call or connection (each swallows its own failure)', (m061.match(/exception when others then/g) ?? []).length === 3)
  check('linking a table claims it THROUGH the existing guard trigger (the caller\'s own id only) and writes the feed event',
    /update public\.waiter_tables t set held_by_staff_id = v_staff where t\.id = p_table_id/.test(m061) && /'table_chained'/.test(m061))
  check('the feed vocabulary keeps 023\'s list and adds exactly the four new events',
    ['table_chained', 'customer_connected', 'customer_order', 'customer_call'].every((e) => new RegExp(`'${e}'`).test(m061)) && /'item_reassigned'/.test(m061))
}

section('the staff alerts — wording, tags, urgency')
{
  const call = P.buildCallPayload({ callId: 'c1', tableNumber: 12, kind: 'bill', cartItems: 3 }, 'oms')
  check('a call says the table and what they want, and stays on screen', call.kind === 'table-call' && /12/.test(call.title) && /חשבון/.test(call.title) && call.urgent === true && call.vibrate.length > 0)
  check('…its body mentions the cart only when there is one', /3 פריטים/.test(call.body) && !/עגלה/.test(P.buildCallPayload({ callId: 'c1', tableNumber: 12, kind: 'waiter', cartItems: 0 }, 'oms').body))
  check('…one tag per call, so a repeat REPLACES it in the tray', call.tag === 'table-call-c1')
  check('every call kind has its own words, and an unknown kind falls back to "waiter" (never "undefined")',
    ['waiter', 'bill', 'assistance'].every((k) => !/undefined/.test(P.buildCallPayload({ callId: 'x', tableNumber: 1, kind: k, cartItems: 0 }, 'portal').title))
    && /קורא למלצר/.test(P.buildCallPayload({ callId: 'x', tableNumber: 1, kind: 'nonsense', cartItems: 0 }, 'portal').title))
  const con = P.buildConnectedPayload({ tableNumber: 5 }, 'oms')
  check('"customers connected" is information, not an alarm: not urgent, one notification per table', con.kind === 'table-connected' && con.urgent === false && con.tag === 'table-connected-5' && /5/.test(con.title))
  const ord = P.buildOrderPayload({ submissionId: 's1', tableNumber: 7, itemCount: 4, totalAgorot: 8200 }, 'oms')
  const esc = P.escalated(ord, 90)
  check('an ESCALATED alert says how long it has waited, has its own tag (it must not replace the first) and is urgent',
    /90 שניות/.test(esc.body) && esc.tag === 'table-order-s1-escalated' && esc.tag !== ord.tag && esc.urgent === true && /מי פנוי/.test(esc.body) && ord.body.length > 0 && esc.body.includes(ord.body))
  check('…and past two minutes it speaks in minutes', /3 דקות/.test(P.escalated(ord, 180).body))
  check('the POS opens its own home, the portal opens the staff dashboard (for every kind)',
    [call, con, ord, P.buildReadyPayload({ orderId: 'o', tableLabel: '4', itemNames: ['בירה'], station: 'bar' }, 'oms'), P.buildSentPayload({ orderId: 'o', batchNo: 1, tableLabel: '4', station: 'bar', itemCount: 2 }, 'oms')].every((x) => x.url === '/')
    && [P.buildCallPayload({ callId: 'c', tableNumber: 1, kind: 'waiter', cartItems: 0 }, 'portal'), P.buildConnectedPayload({ tableNumber: 1 }, 'portal')].every((x) => x.url === '/staff/dashboard'))
  const ready = P.buildReadyPayload({ orderId: 'o1', tableLabel: '4', itemNames: ['א', 'ב', 'ג', 'ד', 'ה'], station: 'kitchen' }, 'oms')
  check('a ready alert lists at most three items and counts the rest', /\+2/.test(ready.body) && ready.title.includes('4') && ready.tag === 'items-ready-o1')
  const sent = P.buildSentPayload({ orderId: 'o1', batchNo: 2, tableLabel: '4', station: 'kitchen', itemCount: 3 }, 'oms')
  check('a "sent to the station" alert names the station and the table, with a tag per order+batch+station', /מטבח/.test(sent.title) && /3 פריטים/.test(sent.body) && sent.tag === 'items-sent-o1-2-kitchen' && /בר/.test(P.buildSentPayload({ orderId: 'o', batchNo: 1, tableLabel: '1', station: 'bar', itemCount: 1 }, 'oms').title))
}

section('the call route — a connected phone names no table; the typed way still works')
{
  const routeFile = code('src/app/api/table/call/route.ts')
  const route = routeFile.slice(routeFile.indexOf('export async function POST'))
  const idx = (re) => { const m = route.search(re); return m < 0 ? Infinity : m }
  check('rails in order: origin/JSON → size → the switch → rate limits → the body → the database',
    idx(/originHost !== host/) < idx(/content-length/) && idx(/content-length/) < idx(/flags\.call/) && idx(/flags\.call/) < idx(/checkRateLimit/) && idx(/checkRateLimit/) < idx(/request\.json\(\)/) && idx(/request\.json\(\)/) < idx(/\.rpc\(/))
  check('a connected phone uses the SESSION\'s table: the RPC is handed the token, never a table number', /rpc\('create_table_call_for_session', \{\s*p_token: token,\s*p_kind/.test(route) && !/create_table_call_for_session[\s\S]{0,200}p_table_number/.test(route))
  check('…its input is validated by the session gate (a tableNumber in the body is ignored, not used)', /validateSessionCallInput\(body\)/.test(route))
  check('a session the database no longer accepts falls through to the typed number — and says so when there is none', /\['no_session', 'expired', 'ended'\]/.test(route) && /token \? 'no_session' : parsed\.error/.test(route))
  check('before migration 061 exists (42883) the typed way still works exactly as before', /error\.code !== '42883'/.test(route) && /rpc\('create_table_call'/.test(route))
  check('the waiter\'s FIRST name comes from table_session_waiter, only for a connected phone', /rpc\('table_session_waiter', \{ p_token: token \}\)/.test(route) && /waiterName/.test(route))
  check('a repeat tap (duplicate) pages nobody twice', /const duplicate = row\.reason === 'duplicate'/.test(route) && /if \(!duplicate && typeof row\.call_id === 'string'\)/.test(route))
  check('the push is after the response and carries the TABLE the database named', /afterResponse\(\(\) => notifyStaffOfCall\(alert\)\)/.test(route) && /tableId: row\.table_id \?\? null/.test(route))
  check('the response echoes no id', !/call_id/.test(route.slice(route.indexOf('NextResponse.json({ ok: true'))))
  check('the push may sleep through the escalation window', /export const maxDuration = 150/.test(routeFile))

  const vs = C.validateSessionCallInput({ kind: 'bill', cartItems: 2, cartTotalAgorot: 500, tableNumber: 99 })
  check('the session gate takes kind and cart, and DROPS a table number a body carries (it cannot name a table)', vs.ok && vs.value.kind === 'bill' && !('tableNumber' in vs.value))
  check('…bad kind / bad cart / non-object are refused', C.validateSessionCallInput({ kind: 'x' }).error === 'bad_kind' && C.validateSessionCallInput({ cartItems: -1 }).error === 'bad_cart' && C.validateSessionCallInput(null).error === 'bad_request' && C.validateSessionCallInput([]).error === 'bad_request')
  check('…an empty body is a plain "waiter" call', C.validateSessionCallInput({}).ok && C.validateSessionCallInput({}).value.kind === 'waiter')
  check('the typed gate still requires a table', C.validateCallInput({ kind: 'waiter' }).error === 'bad_table' && C.validateCallInput({ tableNumber: 12 }).ok)
  check('the session reasons map to a status (the route can refuse with them)', C.CALL_REASON_STATUS.no_session === 401 && C.CALL_REASON_STATUS.expired === 410 && C.CALL_REASON_STATUS.ended === 410)

  const sess = code('src/app/api/table/session/route.ts')
  check('the session GET returns the waiter\'s first name (never anything else about them)', /rpc\('table_session_waiter', \{ p_token: token \}\)/.test(sess) && /waiterName:/.test(sess))
  check('connecting pushes the table\'s waiter, after the response', /afterResponse\(\(\) => notifyStaffOfConnection\(alert\)\)/.test(sess) && /typeof row\.table_id === 'string'/.test(sess))
  const parsed = R.parseSessionView({ connected: true, tableNumber: 4, expiresAt: 'x', shiftOpen: true, sent: [], waiterName: '  דנה ' })
  check('the phone\'s view carries the waiter\'s name, trimmed and bounded; anything else is "not connected"', parsed.connected === true && parsed.waiterName === 'דנה'
    && R.parseSessionView({ connected: true, tableNumber: 4 }).connected === false && R.parseSessionView(null).connected === false
    && R.parseSessionView({ connected: true, tableNumber: 4, expiresAt: 'x', waiterName: 'x'.repeat(200) }).waiterName.length === 40
    && R.parseSessionView({ connected: true, tableNumber: 4, expiresAt: 'x', waiterName: 5 }).waiterName === null)
}

section('the staff-event route — the POS tells the portal what happened on the floor')
{
  const routeFile = code('src/app/api/push/staff-event/route.ts')
  const route = routeFile.slice(routeFile.indexOf('export async function POST'))
  const idx = (re) => { const m = route.search(re); return m < 0 ? Infinity : m }
  check('rails in order: origin → size → the Bearer token → an ACTIVE staff row → rate limits → validation → the work',
    idx(/ALLOWED_ORIGINS\.has\(origin\)/) < idx(/content-length/) && idx(/content-length/) < idx(/Bearer/) && idx(/Bearer/) < idx(/auth\.getUser\(token\)/) &&
    idx(/auth\.getUser\(token\)/) < idx(/\.from\('staff'\)/) && idx(/\.from\('staff'\)/) < idx(/checkRateLimit/) && idx(/checkRateLimit/) < idx(/safeParse/) && idx(/safeParse/) < idx(/afterResponse/))
  check('only the POS\'s own origin is allowed (and localhost only outside production)', /'https:\/\/staff\.ayeka\.bar'/.test(routeFile) && /NODE_ENV === 'production' \? \[\]/.test(routeFile))
  check('the token is verified by the Auth server and must belong to an ACTIVE staff member', /service\.auth\.getUser\(token\)/.test(route) && /\.active\s*!==\s*true|active\?: boolean/.test(route) && /\.eq\('auth_user_id', userId\)/.test(route))
  check('the request carries ids ONLY: a strict schema with uuids and bounded lists, no recipient, no message', /\.strict\(\)/.test(routeFile) && /z\.string\(\)\.uuid\(\)/.test(routeFile) && /\.max\(30\)/.test(routeFile) && !/recipient|title|body:\s*z/.test(routeFile.replace(/const body = /, '')))
  check('a per-person and a global rate limit', /staff-event:\$\{staffId\}/.test(route) && /'staff-event:global'/.test(route))
  check('the work happens AFTER the response and the answer is only { ok: true }', /afterResponse\(\(\) =>/.test(route) && /reply\(origin, 200, \{ ok: true \}\)/.test(route))
  check('a preflight is answered for the POS\'s origin only', /export async function OPTIONS/.test(routeFile) && /Access-Control-Allow-Origin/.test(routeFile) && /ALLOWED_ORIGINS\.has\(origin\)/.test(routeFile.slice(routeFile.indexOf('function cors'), routeFile.indexOf('const reply'))))

  const se = code('src/lib/push/station-events.ts')
  check('"ready" re-reads the items from the database: really ready, really recent, on an open order, and the named ids must be among them',
    /\.eq\('status', 'ready'\)/.test(se) && /fresh\(i\.ready_at\)/.test(se) && /readyAll\.some\(\(i\) => named\.has\(i\.id\)\)/.test(se) && /row\.status === 'open' \|\| row\.status === 'filed'/.test(se))
  check('…and tells the TABLE\'S waiter (the holder, else the order\'s waiter, else the shift) — never a name the POS sent', /waiter_table_holder/.test(se) && /order\.waiter_staff_id/.test(se) && /waiter_call_recipient_staff_ids/.test(se))
  check('"sent" tells the people CHECKED IN at that station in the open shift (the latest event per person)', /waiter_station_checkins/.test(se) && /event === 'check_in'/.test(se) && /shift_session_id', shiftId/.test(se) && /i\.status === 'sent'/.test(se))
  check('both never throw (best-effort) and do nothing without VAPID keys', (se.match(/catch \(err\)/g) ?? []).length === 2 && (se.match(/ensureVapidConfigured\(\)/g) ?? []).length === 2)
}

section('the customer\'s words — the waiter, in all three languages')
{
  for (const [name, entry] of Object.entries({
    'call: connected intro': C.CALL_UI.introConnected, 'call: connected table': C.CALL_UI.connectedTable, 'call: your waiter': C.CALL_UI.yourWaiter,
    'call: sent with the waiter': C.CALL_UI.sentBodyWaiter, 'call: session ended (no_session)': C.CALL_UI.errors.no_session, 'call: session ended (expired)': C.CALL_UI.errors.expired,
    'call: session ended (ended)': C.CALL_UI.errors.ended, 'remote: your waiter': R.REMOTE_UI.yourWaiter, 'remote: no waiter yet': R.REMOTE_UI.noWaiterYet,
  })) check(`${name} exists in he, en and ar, each in its own script`, LANGS.every((l) => typeof entry?.[l] === 'string' && entry[l].trim().length > 0) && HEBREW.test(entry.he) && ARABIC.test(entry.ar) && LATIN.test(entry.en) && !ARABIC.test(entry.en))
  check('the waiter\'s name is interpolated, never concatenated (word order differs by language)', LANGS.every((l) => C.CALL_UI.yourWaiter[l].includes('{name}') && R.REMOTE_UI.yourWaiter[l].includes('{name}') && C.CALL_UI.sentBodyWaiter[l].includes('{name}') && C.CALL_UI.connectedTable[l].includes('{n}')))
  check('the helpers fill the placeholders', R.waiterText('דנה', 'he') === 'המלצר שלכם: דנה' && C.callWaiterText('Dana', 'en') === 'Your waiter: Dana' && C.callTableText(7, 'en') === 'Table 7' && !/\{/.test(C.callSentWaiterText('דנה', 'he')))
  const sheet = code('src/components/cart/CallWaiterSheet.tsx')
  check('the call sheet asks the session first, and a connected phone is shown its table and waiter instead of an input', /fetch\('\/api\/table\/session'/.test(sheet) && /parseSessionView/.test(sheet) && /session !== null && !connected/.test(sheet) && /callWaiterText\(connected\.waiterName/.test(sheet))
  check('…and sends NO table number when connected', /\.\.\.\(connected \? \{\} : \{ tableNumber \}\)/.test(sheet))
  check('…and if the connection ended meanwhile, the number field appears (it does not retry blind)', /json\.error === 'no_session' \|\| json\.error === 'ended' \|\| json\.error === 'expired'\) setSession\(\{ connected: false \}\)/.test(sheet))
  const order = code('src/components/cart/TableOrderSheet.tsx')
  check('the connect sheet shows who the waiter is and refreshes every 5 seconds (it used to be 15)', /waiterText\(connected\.waiterName/.test(order) && /POLL_MS = 5_000/.test(order))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('\nFAILED:'); for (const f of failures) console.log(`  · ${f}`); process.exit(1) }
