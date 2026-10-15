#!/usr/bin/env node
// Harness for a person's OWN details — name, phone, colour, emoji — and the places that hand them out (2026-10-15).
//
//   node scripts/check-profile.mjs
//
// Owner: the onboarding wizard lets a new employee "change first or last name, add a phone number and select a colour and
// emoji"; accounts the owner creates get a random colour and emoji. The rules are pure (lib/staff/profile.ts) so this
// runs the REAL TypeScript; the claims that matter most are structural, so it also reads the routes as text:
//   • the profile route edits only the SESSION's own row — the body can never name a person or touch access;
//   • the phone is the one column that may not exist yet (migration 062) and must never block the rest;
//   • the SQL CHECK and the TypeScript regex are one rule spelled twice;
//   • creating a person assigns an identity, and the logout / login changes the owner asked for are in place.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const outDir = join(tmpdir(), `ayeka-profile-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'profile.mjs'), ts.transpileModule(read('src/lib/staff/profile.ts'), {
  fileName: 'profile.ts', compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
}).outputText)
const P = await import(pathToFileURL(join(outDir, 'profile.mjs')).href)

let pass = 0
const failures = []
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) } }
const section = (t) => console.log(`\n${t}`)
const HEBREW = /[֐-׿]/
const cps = (s) => [...s].length

section('the palettes')
{
  check('12 colours, all valid 6-digit hex (staff.colour\'s CHECK accepts them), no duplicates', P.PROFILE_COLOURS.length === 12 && P.PROFILE_COLOURS.every((c) => /^#[0-9a-f]{6}$/i.test(c)) && new Set(P.PROFILE_COLOURS).size === 12)
  check('every colour has a Hebrew name, in the same order', P.PROFILE_COLOUR_NAMES.length === P.PROFILE_COLOURS.length && P.PROFILE_COLOUR_NAMES.every((n) => HEBREW.test(n)))
  check('every emoji is ONE code point, so staff.initial\'s CHECK (length 1..2) always holds; no duplicates',
    P.PROFILE_EMOJIS.every((e) => cps(e) === 1) && new Set(P.PROFILE_EMOJIS).size === P.PROFILE_EMOJIS.length && P.PROFILE_EMOJIS.length >= 20)
  const mig021 = read('supabase/migrations/021_staff_identity_display.sql')
  check('…and those really are the column rules (021: hex colour, initial 1..2 characters)', /colour ~\* '\^#\[0-9a-f\]\{3\}\(\[0-9a-f\]\{3\}\)\?\$'/.test(mig021) && /length\(initial\) between 1 and 2/.test(mig021))
}

section('random identities for created accounts')
{
  const seq = (...v) => { let i = 0; return () => v[i++ % v.length] }
  const empty = P.pickIdentity([], seq(0))
  check('with nobody on the roster it returns a palette colour and emoji', P.PROFILE_COLOURS.includes(empty.colour) && P.PROFILE_EMOJIS.includes(empty.initial))
  const first = P.PROFILE_COLOURS[0], firstE = P.PROFILE_EMOJIS[0]
  const used = [{ colour: first, initial: firstE }, { colour: first, initial: firstE }]
  const next = P.pickIdentity(used, seq(0))
  check('it picks the LEAST-used colour and emoji — two people on one shift rarely look alike', next.colour !== first && next.initial !== firstE)
  const all = P.PROFILE_COLOURS.map((c, i) => ({ colour: c, initial: P.PROFILE_EMOJIS[i] }))
  const rest = P.pickIdentity([...all, { colour: first, initial: firstE }], seq(0))
  check('once every colour is taken, the repeat goes to a colour used only once, never the doubled one', rest.colour !== first)
  const seen = new Set(); for (let i = 0; i < 200; i++) seen.add(P.pickIdentity([]).colour)
  check('it is actually random (many different colours over many calls)', seen.size > 6)
  check('junk values on existing rows (null, unknown) are ignored, not crashed on', P.PROFILE_COLOURS.includes(P.pickIdentity([{ colour: null, initial: null }, { colour: 'red', initial: 'x' }, {}]).colour))
}

section('the phone')
{
  const N = P.normalizePhone
  check('Israeli mobile in every way people type it → 0XXXXXXXXX', ['050-123 4567', '0501234567', '(050) 123-4567', '050.123.4567', ' 050 1234567 '].every((v) => N(v) === '0501234567'))
  check('+972 / 00972 forms → the local form', N('+972 50 123 4567') === '0501234567' && N('00972501234567') === '0501234567')
  check('a landline (9 digits) is accepted', N('03-1234567') === '031234567')
  check('another country\'s number is kept in + form', N('+1 415 555 0123') === '+14155550123')
  check('garbage, too short, too long and letters are refused', ['', 'abc', '123', '05012', '050123456789012345', 'phone: 0501234567', '+', '++972501234567'].every((v) => N(v) === null))
  check('SQL injection / markup is refused, never stored', N("0501234567'; drop table staff;--") === null && N('<b>0501234567</b>') === null)
  const mig062 = read('supabase/migrations/062_staff_phone.sql')
  const sqlRe = mig062.match(/phone ~ '([^']+)'/)?.[1]
  check('migration 062\'s CHECK and PHONE_RE are one rule spelled twice', !!sqlRe && sqlRe.replace(/\\\+/g, '+') === P.PHONE_RE.source.replace(/\\\+/g, '+').replace(/^\^|\$$/g, (m) => m), `${sqlRe} vs ${P.PHONE_RE.source}`)
  const pgRe = new RegExp(sqlRe ?? '^$')
  check('…and every normalised form passes the SQL regex (and nothing else does)', ['0501234567', '031234567', '+14155550123'].every((v) => pgRe.test(v)) && !['050', 'abc', '0501234567890123'].some((v) => pgRe.test(v)))
  check('062 only adds a nullable column and a CHECK — no policy, grant, view or function', /add column if not exists phone text;/.test(mig062) && !/create (policy|view|function|table)|grant |revoke /i.test(mig062.replace(/--.*$/gm, '')))
}

section('the form\'s validation')
{
  const V = P.validateProfile
  const ok = V({ firstName: '  דנה  ', lastName: 'כהן', phone: '050-1234567', colour: P.PROFILE_COLOURS[3], initial: P.PROFILE_EMOJIS[2] })
  check('a good form is cleaned and accepted', ok.ok && ok.value.first_name === 'דנה' && ok.value.last_name === 'כהן' && ok.value.phone === '0501234567' && ok.value.colour === P.PROFILE_COLOURS[3] && ok.value.initial === P.PROFILE_EMOJIS[2])
  check('the first name is required; the last name is optional (stored null)', !V({ firstName: '' }).ok && !V({ firstName: '   ' }).ok && !V({}).ok && V({ firstName: 'דנה', lastName: '  ' }).value.last_name === null)
  check('names are capped at 40 characters', !V({ firstName: 'א'.repeat(41) }).ok && V({ firstName: 'א'.repeat(40) }).ok && !V({ firstName: 'דנה', lastName: 'ב'.repeat(41) }).ok)
  check('control and zero-width characters are stripped from a name; inner whitespace collapses', V({ firstName: 'ד​נה\u0000  ב\n\tן' }).value.first_name === 'דנה ב ן')
  check('a non-string name is refused, not coerced', !V({ firstName: 5 }).ok && !V({ firstName: { a: 1 } }).ok && !V({ firstName: ['דנה'] }).ok)
  check('an empty phone CLEARS it (null); an absent phone leaves it alone (undefined); a bad phone is refused',
    V({ firstName: 'א', phone: '' }).value.phone === null && V({ firstName: 'א', phone: null }).value.phone === null && V({ firstName: 'א' }).value.phone === undefined && !V({ firstName: 'א', phone: '12' }).ok && !V({ firstName: 'א', phone: 5 }).ok)
  check('a colour or emoji outside the palettes is refused (it ends up in a style attribute and a CHECK)', !V({ firstName: 'א', colour: '#000000' }).ok && !V({ firstName: 'א', colour: 'red' }).ok && !V({ firstName: 'א', colour: 'url(x)' }).ok && !V({ firstName: 'א', initial: 'A' }).ok && !V({ firstName: 'א', initial: '👨‍👩‍👧' }).ok)
  check('every refusal has a Hebrew sentence', Object.values(P.PROFILE_MESSAGES).every((m) => HEBREW.test(m)))
}

section('wiring (read as text)')
{
  const route = code('src/app/api/staff/me/profile/route.ts')
  check('the profile route is for signed-in STAFF only', /requireStaff\(\)/.test(route) && !/requireOwner|requireDev/.test(route))
  check('WHO is edited comes from the session: the row is looked up by auth_user_id, and the body is never read for an id',
    /\.eq\('auth_user_id', auth\.userId\)/.test(route) && !/body\??\.(id|staffId|staff_id|userId|user_id|authUserId)\b/.test(route) && !/\.eq\('id', body/.test(route))
  check('it can never write access: role, badge, active, email, auth_user_id are not in any patch',
    !/\b(role|badge|active|email|auth_user_id)\s*:/.test(route.slice(route.indexOf('const patch'), route.indexOf('const patch') + 300)))
  check('every field goes through the pure validator before a write', route.indexOf('validateProfile(') > -1 && route.indexOf('validateProfile(') < route.indexOf('.update('))
  check('the phone is written on its own, so a missing column (062) never blocks the rest', /update\(\{ phone \}\)/.test(route) && /phoneSaved/.test(route) && /phoneReady/.test(route))
  check('it is rate limited', /staff-profile:/.test(route))
  const owner = code('src/app/api/owner/staff/route.ts')
  check('creating a person (with or without an email) hands out a random colour and emoji', (owner.match(/\.\.\.\(await newIdentity\(auth\.service\)\)/g) ?? []).length === 2 && /pickIdentity\(/.test(owner))
  check('the roster read tolerates the phone column not existing yet', /phonesById/.test(owner) && /if \(error\) return new Map\(\)/.test(owner))
  const step = code('src/components/staff/StaffProfileStep.tsx')
  check('the details step stores nothing on the device and is never a gate (it can be skipped, and a failed load goes on)', !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(step) && /דילוג/.test(step) && /loadFailed/.test(step))
  check('the phone field is offered only when the server says the column exists', /loaded\.phoneReady &&/.test(step))
  check('swatches are labelled by NAME, never by colour alone', /aria-label=\{PROFILE_COLOUR_NAMES\[i\]\}/.test(step))

  const so = code('src/components/SignOutButton.tsx')
  check('logging out goes to the sign-in page (owner, 2026-10-15), not the portal', /router\.push\('\/login'\)/.test(so) && !/router\.push\('\/'\)/.test(so))
  const login = code('src/app/login/page.tsx')
  check('the sign-in page has a clear button to the main page', /href="\/"[^>]*style=\{\{ \.\.\.mainBtnStyle/.test(login) && /main: 'לעמוד הראשי'/.test(login))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
