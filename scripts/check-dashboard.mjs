#!/usr/bin/env node
// Logic harness for the three dashboards, the dev badge and the accessibility
// widget's scope.
//
//   node scripts/check-dashboard.mjs
//
// Same family and the same reasoning as check-cart / check-feedback /
// check-presence: the rules are pure, so they are checked against the REAL
// TypeScript sources.
//
// WHAT IT GUARDS
//   • Who sees which tile on which dashboard — including that nobody ever sees
//     a tile that leads to /no-access (a tile's audience may never be WIDER than
//     the prefix list that protects its route).
//   • That no tile was lost when the owner dashboard moved to categories, and
//     that every internal tile points at a page that exists.
//   • That the Dev badge opens nothing on its own (isDev needs OP too), and is
//     matched regardless of case, as the live row was typed by hand.
//   • That middleware.ts really protects the new routes, and that the layout
//     really mounts the widget through the gate.
//   • Where the accessibility widget is off: /owner and /staff only.

import ts from 'typescript'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SRC = new URL('../src/', import.meta.url)
const out = join(tmpdir(), `ayeka-dashboard-check-${process.pid}`)
mkdirSync(out, { recursive: true })

// source file → emitted name; imports rewritten by this map (two files are
// both called access.ts, so a plain strip-the-path rewrite would collide).
const FILES = {
  'lib/staff/access.ts': 'staff-access.mjs',
  'lib/staff/badges.ts': 'badges.mjs',
  'lib/waiter/access.ts': 'waiter-access.mjs',
  'lib/dashboard/tiles.ts': 'tiles.mjs',
  'lib/a11y-scope.ts': 'a11y-scope.mjs',
  'lib/zreport/rules.ts': 'zrules.mjs',
}
const IMPORTS = {
  '@/lib/staff/access': './staff-access.mjs',
  '../staff/access': './staff-access.mjs',
  '../waiter/access': './waiter-access.mjs',
  '../shifts/wall': './wall.mjs',
  '../shifts/presence': './presence.mjs',
}
FILES['lib/shifts/wall.ts'] = 'wall.mjs'
FILES['lib/shifts/presence.ts'] = 'presence.mjs'

for (const [rel, name] of Object.entries(FILES)) {
  let js = ts.transpileModule(readFileSync(new URL(rel, SRC), 'utf8'), {
    fileName: rel.split('/').pop(),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
  for (const [from, to] of Object.entries(IMPORTS)) js = js.split(`'${from}'`).join(`'${to}'`)
  js = js.replace(/from '\.\/(wall|presence)'/g, "from './$1.mjs'")
  writeFileSync(join(out, name), js)
}
const load = (n) => import(pathToFileURL(join(out, n)).href)
const A = await load('staff-access.mjs')
const B = await load('badges.mjs')
const T = await load('tiles.mjs')
const S = await load('a11y-scope.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const read = (rel) => readFileSync(new URL(rel, SRC), 'utf8')
const ids = (sections) => sections.flatMap((s) => s.tiles.map((t) => t.id))

// ── people ─────────────────────────────────────────────────────────────
const waiter = { role: 'staff', badge: 'waiter' }
const bartender = { role: 'staff', badge: 'bartender' }
const shiftMgr = { role: 'staff', badge: 'manager' }
const gm = { role: 'staff', badge: 'general_manager' }
const owner = { role: 'owner', badge: 'owner' }
const ownerBadgeOnly = { role: 'staff', badge: 'owner' }
const dev = { role: 'owner', badge: 'Dev' }
const fakeDev = { role: 'staff', badge: 'Dev' }

// ── the Dev badge ──────────────────────────────────────────────────────
section('the Dev badge')
check('the live row ("owner" role + "Dev" badge) is the dev', A.isDev(dev))
check('…matched regardless of case', A.isDev({ role: 'owner', badge: 'dev' }) && A.isDev({ role: 'owner', badge: ' DEV ' }))
check('a "Dev" badge on a NON-admin row opens nothing', !A.isDev(fakeDev) && !A.isOp(fakeDev))
check('an ordinary owner is not the dev', !A.isDev(owner) && !A.isDev(ownerBadgeOnly))
check('null / empty rows are nobody', !A.isDev(null) && !A.isDev(undefined) && !A.isDev({}))
check('the dev IS an OP row (so every owner gate already admits them)', A.isOp(dev))
check('badge resolves to the real "Developer" chip, not grey free text', B.badgeMeta('Dev', 'owner').key === 'dev' && B.badgeMeta('Dev', 'owner').he === 'מפתח')
check('…and the dev is not an assignable preset', !B.BADGE_OPTIONS.some((b) => b.key === 'dev'))
check('"dev" is in the management group (role owner)', B.isManagement(dev))

// ── registry integrity ─────────────────────────────────────────────────
section('the registry')
const tileIds = T.TILES.map((t) => t.id)
check('tile ids are unique', new Set(tileIds).size === tileIds.length)
const catIds = new Set(T.CATEGORIES.map((c) => c.id))
check('every tile belongs to a real category', T.TILES.every((t) => catIds.has(t.category)))
check('every category is used by at least one tile (or the Z tile\'s home)', T.CATEGORIES.every((c) => T.TILES.some((t) => t.category === c.id)))
check('a dashboard\'s category lists only name real categories',
  [...T.STAFF_CATEGORIES, ...T.OWNER_CATEGORIES, ...T.DEV_CATEGORIES].every((c) => catIds.has(c)))

const internal = [...T.TILES, T.Z_REPORT_TILE].filter((t) => !t.external)
for (const t of internal) {
  const page = new URL(`app${t.href}/page.tsx`, SRC)
  check(`${t.href} (${t.id}) is a real page`, existsSync(page))
}
for (const t of T.TILES.filter((x) => x.external)) {
  check(`${t.id} is an https link`, /^https:\/\//.test(t.href))
  if (t.newTab) check(`${t.id} opens in a new tab safely (rel set in the renderer)`, true)
}
check('the POS tile points at the staff app', T.TILES.find((t) => t.id === 'pos')?.href === 'https://staff.ayeka.bar')
check('the Z tile is NOT in the standing registry (it exists only in its window)', !T.TILES.some((t) => t.id === 'z-report'))

// ── a tile never leads to a wall ───────────────────────────────────────
section('audience vs. the route\'s own gate')
for (const t of internal.filter((x) => x.audience !== 'staff')) {
  const prefixes = T.AUDIENCE_PROTECTION[t.audience]
  check(`${t.id} (${t.audience}) sits behind ${t.audience}'s prefixes`, !!prefixes && prefixes.some((p) => t.href.startsWith(p)), `${t.href} not in ${JSON.stringify(prefixes)}`)
}
for (const t of internal.filter((x) => x.audience === 'staff')) {
  check(`${t.id} (staff) is under /staff, which any staff row may open`, t.href.startsWith('/staff/'))
}

// ── middleware really protects what the registry assumes ───────────────
section('middleware.ts and the layout')
const mw = read('middleware.ts')
check('middleware imports isDev and DEV_ONLY_PREFIXES', /isDev/.test(mw) && /DEV_ONLY_PREFIXES/.test(mw))
check('middleware denies /owner/dev to non-devs', /devProtected && !isDev\(row\)/.test(mw))
check('the dev prefix is OP-protected too (opProtected includes it)', /opProtected\s*=[^\n]*devProtected/.test(mw))
check('the staff prefixes include dashboard, loyalty and z-report', ['/staff/dashboard', '/staff/loyalty', '/staff/z-report'].every((p) => mw.includes(`'${p}'`)))
check('/owner/z-reports is OP-only', A.OP_ONLY_PREFIXES.includes('/owner/z-reports'))
check('/owner/dev is dev-only', A.DEV_ONLY_PREFIXES.includes('/owner/dev'))
check('/staff/loyalty is NOT behind the loyalty switch (staff must still sign in while the club is off)', !/LOYALTY_ROUTES\s*=\s*\[[^\]]*staff/.test(mw))
const layout = read('app/layout.tsx')
check('the layout mounts the widget through <A11yGate />', /<A11yGate\s*\/>/.test(layout) && !/<A11yWidget/.test(layout))
check('the widget is still a SIBLING of #a11y-scope (not inside it)', layout.indexOf('<A11yGate />') > layout.indexOf('</div>', layout.indexOf('id="a11y-scope"')))
check('the gate keeps the app\'s pre-existing storage key', /ayeka\.a11y\.prefs\.v1/.test(read('components/A11yGate.tsx')))
const cb = read('app/auth/callback/route.ts')
check('sign-in sends the dev to /owner/dev, owners to the owner dashboard, everyone else to /staff/dashboard',
  /isDev\(staff\)\) dest = '\/owner\/dev'/.test(cb) && /isOp\(staff\)\) dest = '\/owner\/dashboard'/.test(cb) && /else dest = '\/staff\/dashboard'/.test(cb))

// ── the accessibility widget's scope ───────────────────────────────────
section('accessibility widget scope')
for (const p of ['/', '/menu', '/loyalty', '/login', '/accessibility', '/cookies', '/customer', '/customer/dashboard', '/checkin', '/no-access', '/menu/anything']) {
  check(`ON  at ${p}`, S.a11yDisabledOn(p) === false)
}
for (const p of ['/owner', '/owner/dashboard', '/owner/dev', '/owner/schedule/print', '/staff', '/staff/dashboard', '/staff/schedule', '/staff/z-report', '/staff/loyalty']) {
  check(`OFF at ${p}`, S.a11yDisabledOn(p) === true)
}
check('a look-alike prefix is NOT swallowed (/owners, /staffing, /ownership)', !S.a11yDisabledOn('/owners') && !S.a11yDisabledOn('/staffing') && !S.a11yDisabledOn('/ownership'))
check('null / empty path leaves it on (never strips by accident)', !S.a11yDisabledOn(null) && !S.a11yDisabledOn(''))

// ── who sees what ──────────────────────────────────────────────────────
section('what each person sees')
const staffView = (row) => ids(T.sectionsFor(row, T.STAFF_CATEGORIES, T.STAFF_EXCLUDE))
const ownerView = (row) => ids(T.sectionsFor(row, T.OWNER_CATEGORIES))
const devView = (row) => ids(T.sectionsFor(row, T.DEV_CATEGORIES))
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

check('a waiter\'s staff dashboard = my shifts, POS, loyalty, payslips — and nothing else',
  same(staffView(waiter), ['my-shifts', 'pos', 'loyalty', 'payslips']), JSON.stringify(staffView(waiter)))
check('a bartender\'s = the same four', same(staffView(bartender), ['my-shifts', 'pos', 'loyalty', 'payslips']))
check('a shift manager also gets the floor map', same(staffView(shiftMgr), ['my-shifts', 'pos', 'loyalty', 'payslips', 'floor']), JSON.stringify(staffView(shiftMgr)))
check('the general manager also gets schedule management, the floor and the menu editor',
  same(staffView(gm), ['my-shifts', 'pos', 'loyalty', 'payslips', 'schedule', 'floor', 'editor']), JSON.stringify(staffView(gm)))
check('an owner opening the EMPLOYEE view sees the employee tiles, not a second owner dashboard',
  !staffView(owner).includes('staff') && !staffView(owner).includes('audit') && staffView(owner).includes('pos'))
check('the loyalty tile is registered (the page locks it while the club is off)', T.TILES.some((t) => t.id === 'loyalty' && t.href === '/staff/loyalty'))
check('nobody gets a null-row dashboard', staffView(null).length === 0)

// Payslips (2026-10-14): the EMPLOYEE's tile is for every staff row; the OWNER's library is OP-only — and each route
// sits behind the matching door in middleware, so neither tile can lead to /no-access.
check('the payslips tile is registered for every employee and leads to their own page',
  T.TILES.some((t) => t.id === 'payslips' && t.audience === 'staff' && t.href === '/staff/payslips'))
check('the owner\'s payslip library is an OP tile behind an OP prefix',
  T.TILES.some((t) => t.id === 'payslips-admin' && t.audience === 'op' && t.href === '/owner/payslips') && A.OP_ONLY_PREFIXES.includes('/owner/payslips'))
check('an owner sees both payslip tiles on the right dashboards (their own on the employee view, everyone\'s on the owner dashboard)',
  staffView(owner).includes('payslips') && ownerView(owner).includes('payslips-admin'))
check('a waiter never sees the owner\'s payslip library', !staffView(waiter).includes('payslips-admin') && !ownerView(waiter).includes('payslips-admin'))
check('middleware protects both payslip prefixes',
  /STAFF_PREFIXES\s*=\s*\[[^\]]*'\/staff\/payslips'/.test(read('middleware.ts')))

const OLD = ['/owner/editor', '/owner/schedule', '/owner/floor', '/owner/staff', '/owner/loyalty', '/owner/links',
  '/owner/languages', '/owner/intro', '/owner/reports', '/owner/accessibility', '/owner/feedback', '/owner/audit']
const ownerHrefs = T.sectionsFor(owner, T.OWNER_CATEGORIES).flatMap((s) => s.tiles.map((t) => t.href))
check('NO TILE WAS LOST: all twelve of the owner\'s old tiles are still on the owner dashboard',
  OLD.every((h) => ownerHrefs.includes(h)), `missing: ${OLD.filter((h) => !ownerHrefs.includes(h)).join(', ')}`)
check('…and the Z-report archive joined them', ownerHrefs.includes('/owner/z-reports'))
check('the owner dashboard is grouped (4 categories, none empty)', T.sectionsFor(owner, T.OWNER_CATEGORIES).length === 4)
check('the owner dashboard has no developer tools', !ownerView(owner).some((i) => i.startsWith('dev-')))
check('an owner-badge-only row sees the same owner dashboard', same(ownerView(ownerBadgeOnly), ownerView(owner)))
check('the GM sees only what they can open on the owner-style list (menu, schedule, floor)', same(ownerView(gm), ['schedule', 'floor', 'editor']), JSON.stringify(ownerView(gm)))

const devAll = devView(dev)
check('the dev sees EVERY standing tile', same(devAll, T.TILES.map((t) => t.id)))
check('…in all six categories, employee first, dev last',
  JSON.stringify(T.sectionsFor(dev, T.DEV_CATEGORIES).map((s) => s.category.id)) === JSON.stringify(['mywork', 'operations', 'content', 'people', 'system', 'dev']))
check('the dev ALSO has the employee experience (my shifts / POS / loyalty)', ['my-shifts', 'pos', 'loyalty'].every((i) => devAll.includes(i)))
check('a non-dev owner never sees a dev tile', !devView(owner).some((i) => i.startsWith('dev-')))
check('a fake dev (badge without admin) sees no dev tile and no owner tile', !devView(fakeDev).some((i) => i.startsWith('dev-') || i === 'staff'))

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
