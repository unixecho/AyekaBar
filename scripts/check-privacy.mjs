#!/usr/bin/env node
// Check for the storage declaration (src/lib/privacy/ + the /cookies page + the
// one-time notice + the footer links + the self-hosted font).
//
//   node scripts/check-privacy.mjs
//
// A privacy notice is only worth anything while it is TRUE. The way one stops
// being true is that somebody adds a feature that writes a new localStorage key,
// or pastes in a script tag, and nobody updates a page that lives somewhere
// else. So this does not test that the page renders — it holds the CODE to what
// the page says, by reading the real source:
//
//   • every localStorage / sessionStorage key the app reads or writes is
//     declared in the registry, and every key the registry declares is really
//     used (no ghosts) — including the two the accessibility widget derives;
//   • cookies are written only by the files that pass Supabase's own cookies
//     through, or that delete (a new cookie writer fails until it is declared);
//   • nothing is loaded from another company: no remote font / script /
//     stylesheet / iframe / import, no host in the source that is not our own, a
//     declared link-out, or the SVG namespace — and no analytics dependency;
//   • the facts the page states (the cart's 8 hours, the history's 25 entries,
//     the sign-in cookie's 400 days and its attributes) are compared with the
//     constants and the library's defaults they came from;
//   • nothing in the `analytics` / `marketing` categories can exist without a
//     real opt-in mechanism (CONSENT_MECHANISM_BUILT) — which is the point at
//     which the law DOES ask for consent (PLAYBOOK §3);
//   • the delete-everything and tidy-leftovers actions work, and survive storage
//     that throws (private windows do);
//   • the pieces are wired: the /cookies route, the footer links on the portal
//     and the menu, the notice, the cleanup, the font.
//
// WHAT IT DOES NOT COVER
//   What a browser does at runtime. A key built from a template string or a
//   variable cannot be resolved statically — the scan REFUSES those, so a
//   developer must write a constant or a literal. And it cannot see a cookie a
//   library writes on its own; that is what the Supabase defaults check and the
//   cookie-writer allowlist are for. The live site was also checked by hand on
//   2026-10-04 (anonymous visit: zero Set-Cookie headers; hosts contacted).

import ts from 'typescript'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url))
const read = (rel) => readFileSync(join(ROOT_DIR, rel), 'utf8')
const exists = (rel) => existsSync(join(ROOT_DIR, rel))

const outDir = join(tmpdir(), `ayeka-privacy-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
async function load(rel, out, rewrite) {
  let text = ts.transpileModule(read(rel), {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
  if (rewrite) text = rewrite(text)
  writeFileSync(join(outDir, out), text)
  return import(pathToFileURL(join(outDir, out)).href)
}
const N = await load('src/lib/privacy/notice.ts', 'notice.mjs')
const R = await load('src/lib/privacy/registry.ts', 'registry.mjs',
  (s) => s.replace(/from\s+['"]\.\/notice['"]/g, "from './notice.mjs'"))
const H = await load('src/lib/privacy/housekeeping.ts', 'housekeeping.mjs')
const C = await load('src/lib/privacy/copy.ts', 'copy.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const LANGS = ['he', 'en', 'ar']
const HEBREW = /[֐-׿]/
const ARABIC = /[؀-ۿ]/
const LATIN = /[A-Za-z]/

// ── reading the source ─────────────────────────────────────────────────────
function walk(rel, exts, acc = []) {
  for (const name of readdirSync(join(ROOT_DIR, rel))) {
    const p = `${rel}/${name}`
    if (statSync(join(ROOT_DIR, p)).isDirectory()) walk(p, exts, acc)
    else if (exts.some((e) => name.endsWith(e))) acc.push(p)
  }
  return acc
}
/** Code with its comments blanked. A `//` only starts a comment after whitespace
 *  or punctuation, so the `//` of `https://` inside a string survives. */
function stripComments(code, css = false) {
  let s = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  if (!css) s = s.replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1')
  return s
}
const lineOf = (code, index) => code.slice(0, index).split('\n').length

const srcFiles = walk('src', ['.ts', '.tsx'])
const cssFiles = walk('src', ['.css'])
const code = new Map(srcFiles.map((f) => [f, stripComments(read(f))]))
const css = new Map(cssFiles.map((f) => [f, stripComments(read(f), true)]))

// ───────────────────────────────────────────────────────────────────────────
section('registry — every entry is complete, in all three languages')
{
  const items = R.STORAGE_REGISTRY
  check('there is an inventory', items.length >= 10)
  check('ids are unique', new Set(items.map((i) => i.id)).size === items.length)
  check('(kind, name) pairs are unique', new Set(items.map((i) => `${i.kind}:${i.name}`)).size === items.length)
  check('kind / category / audience are from the vocabulary', items.every((i) =>
    ['localStorage', 'sessionStorage', 'cookie'].includes(i.kind) &&
    ['necessary', 'functional', 'analytics', 'marketing'].includes(i.category) &&
    ['everyone', 'signed-in', 'staff'].includes(i.audience)))
  for (const field of ['what', 'why', 'when', 'keeps']) {
    check(`every entry has ${field} in he / en / ar`, items.every((i) =>
      LANGS.every((l) => typeof i[field]?.[l] === 'string' && i[field][l].trim().length > 0)))
    check(`${field}: no stray spaces, he is Hebrew, en is Latin, ar is Arabic`, items.every((i) =>
      LANGS.every((l) => i[field][l] === i[field][l].trim() && !/\s{2,}/.test(i[field][l])) &&
      HEBREW.test(i[field].he) && !ARABIC.test(i[field].he) &&
      LATIN.test(i[field].en) && !HEBREW.test(i[field].en) && !ARABIC.test(i[field].en) &&
      ARABIC.test(i[field].ar) && !HEBREW.test(i[field].ar)))
  }
  check('cookies are sent to the server and carry their attributes; storage is not and does not',
    items.every((i) => i.kind === 'cookie'
      ? i.sentToServer === true && typeof i.attributes === 'string' && i.attributes.length > 0
      : i.sentToServer === false))
  check('the only cookies are the sign-in ones, and only for people who sign in',
    items.filter((i) => i.kind === 'cookie').every((i) => i.audience === 'signed-in' && /^sb-\*-auth-token/.test(i.name)))
  check('the notice\'s own key is the one declared (ACK_KEY)',
    items.some((i) => i.id === 'privacy-ack' && i.name === N.ACK_KEY))
}

section('registry — the claim "no tracking, no advertising" is only ever true by construction')
{
  const offending = R.STORAGE_REGISTRY.filter((i) => i.category === 'analytics' || i.category === 'marketing')
  check('CONSENT_MECHANISM_BUILT is the honest value (no opt-in exists yet)', R.CONSENT_MECHANISM_BUILT === false)
  check('no analytics / marketing item is declared — the notice, the page and the footer say there are none',
    R.CONSENT_MECHANISM_BUILT || offending.length === 0,
    offending.length ? `declared: ${offending.map((i) => i.id).join(', ')} — an opt-in must exist first (PLAYBOOK §3)` : '')
  check('the page renders every public category the registry uses',
    R.STORAGE_REGISTRY.every((i) => i.audience === 'staff' || ['necessary', 'functional'].includes(i.category)))
  const pkg = JSON.parse(read('package.json'))
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  const DENY = /analytics|speed-insights|gtag|google-tag|fbq|facebook-pixel|hotjar|clarity|plausible|posthog|mixpanel|segment|amplitude|sentry|datadog|fullstory|logrocket|intercom|crisp|tawk|heap|matomo|pixel/i
  check('package.json has no analytics / tracking / chat dependency', !deps.some((d) => DENY.test(d)),
    deps.filter((d) => DENY.test(d)).join(', '))
}

section('page copy — every string has all three languages')
{
  const bad = []
  const walkText = (node, path) => {
    if (Array.isArray(node)) { node.forEach((n, i) => walkText(n, `${path}[${i}]`)); return }
    if (node && typeof node === 'object') {
      const keys = Object.keys(node)
      if (same(keys.slice().sort(), ['ar', 'en', 'he'])) {
        for (const l of LANGS) if (typeof node[l] !== 'string' || !node[l].trim()) bad.push(`${path}.${l} empty`)
        if (!HEBREW.test(node.he) || ARABIC.test(node.he)) bad.push(`${path}.he is not Hebrew`)
        if (HEBREW.test(node.en) || ARABIC.test(node.en)) bad.push(`${path}.en contains Hebrew/Arabic`)
        if (!ARABIC.test(node.ar) || HEBREW.test(node.ar)) bad.push(`${path}.ar is not Arabic`)
        for (const l of LANGS) if (node[l] !== node[l].trim() || /\s{2,}/.test(node[l])) bad.push(`${path}.${l} has stray spaces`)
        return
      }
      keys.forEach((k) => walkText(node[k], `${path}.${k}`))
    }
  }
  walkText(C.COOKIES_COPY, 'COOKIES_COPY')
  walkText(N.NOTICE_COPY, 'NOTICE_COPY')
  walkText(N.COOKIES_LINK_LABEL, 'COOKIES_LINK_LABEL')
  check('every text in COOKIES_COPY / NOTICE_COPY / the footer label is complete and in its own script', bad.length === 0, bad.slice(0, 4).join('; '))
  check('the short list has the four statements the code is held to', C.COOKIES_COPY.short.length === 4)
  check('every kind, audience and category used by the registry has a label',
    R.STORAGE_REGISTRY.every((i) => C.COOKIES_COPY.kindName[i.kind] && C.COOKIES_COPY.kindHow[i.kind] &&
      C.COOKIES_COPY.audience[i.audience] && C.COOKIES_COPY.category[i.category]))
  check('the page path is /cookies', N.COOKIES_PATH === '/cookies')
}

// ───────────────────────────────────────────────────────────────────────────
section('code ↔ registry — every storage key the app reads or writes is declared, and every declared key is used')
{
  const consts = new Map()
  for (const [f, c] of code) {
    for (const m of c.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=\n]+)?=\s*(['"`])([^'"`\n$]*)\2/g)) {
      if (!consts.has(m[1])) consts.set(m[1], [])
      consts.get(m[1]).push({ file: f, value: m[3] })
    }
  }
  const found = new Map()      // "localStorage:key" -> files
  const unresolved = []
  const CALL = /\b(localStorage|sessionStorage)\s*\.\s*(getItem|setItem)\s*\(\s*([^,)\n]+?)\s*[,)]/g
  for (const [f, c] of code) {
    for (const m of c.matchAll(CALL)) {
      const [, store, , arg] = m
      let value = null
      const lit = arg.match(/^(['"`])([^'"`$]*)\1$/)
      if (lit) value = lit[2]
      else if (/^[A-Z][A-Z0-9_]*$/.test(arg)) {
        const defs = consts.get(arg) ?? []
        const local = defs.filter((d) => d.file === f)
        const pick = local.length ? local : defs
        if (pick.length === 1 || (pick.length > 1 && new Set(pick.map((d) => d.value)).size === 1)) value = pick[0].value
      }
      if (value === null) { unresolved.push(`${f}:${lineOf(c, m.index)}  ${store}(${arg})`); continue }
      const k = `${store}:${value}`
      if (!found.has(k)) found.set(k, new Set())
      found.get(k).add(f)
    }
  }
  check('every storage key in the source can be resolved to a literal (use a constant or a literal, never a variable)',
    unresolved.length === 0, unresolved.slice(0, 3).join(' | '))

  // The accessibility widget derives two keys from the one it is passed. Since
  // 2026-10-13 that is passed by components/A11yGate.tsx (which keeps the widget
  // off the staff and owner dashboards); the layout only mounts the gate.
  const layout = code.get('src/app/layout.tsx') ?? ''
  const gate = code.get('src/components/A11yGate.tsx') ?? ''
  const sk = gate.match(/storageKey:\s*['"]([^'"]+)['"]/)
  check('the accessibility gate passes the widget its storageKey as a literal, and the layout mounts the gate',
    !!sk && /<A11yGate\s*\/>/.test(layout))
  const widgetKeys = sk ? [`localStorage:${sk[1]}`, `localStorage:${sk[1]}:ui`] : []

  const declared = new Set(R.STORAGE_REGISTRY.filter((i) => i.kind !== 'cookie').map((i) => `${i.kind}:${i.name}`))
  const used = new Set([...Array.from(found.keys()), ...widgetKeys])
  const undeclared = Array.from(used).filter((k) => !declared.has(k))
  const ghosts = Array.from(declared).filter((k) => !used.has(k))
  check('no key is stored without being declared', undeclared.length === 0,
    undeclared.map((k) => `${k} (${Array.from(found.get(k) ?? ['the widget']).join(', ')})`).join('; ') + ' — add it to STORAGE_REGISTRY')
  check('no key is declared that the code no longer uses', ghosts.length === 0, ghosts.join('; '))
  check('the scan found the keys it should (so a comment-stripper bug cannot hide them all)', used.size >= 9, `found ${used.size}`)
}

section('code ↔ registry — cookies are written only where Supabase\'s own are passed through, or deleted')
{
  const WRITE = /document\.cookie\s*=|\.cookies\.set\(|cookieStore\.set\(|cookies\(\)\.set\(/g
  const ALLOW = {
    'src/middleware.ts': 'passes the Supabase client\'s own cookies through',
    'src/lib/supabase/server.ts': 'passes the Supabase client\'s own cookies through',
    'src/app/api/auth/signout/route.ts': 'deletes only',
  }
  const stray = []
  for (const [f, c] of code) {
    if (f.startsWith('src/lib/privacy/')) continue
    for (const m of c.matchAll(WRITE)) if (!ALLOW[f]) stray.push(`${f}:${lineOf(c, m.index)}`)
  }
  check('no file writes a cookie unless it is one of the allowed few', stray.length === 0,
    stray.join(', ') + ' — a new cookie must be declared in STORAGE_REGISTRY and allowed here')
  check('the sign-out route only DELETES (maxAge: 0)', /cookies\.set\([^)]*maxAge:\s*0/.test(code.get('src/app/api/auth/signout/route.ts') ?? ''))
  const hk = read('src/lib/privacy/housekeeping.ts')
  const writes = hk.match(/jar\.write\(/g) ?? []
  check('the cleanup\'s cookie writes are all expiries (Max-Age=0 built once, every write uses it)',
    /Max-Age=0/.test(hk) && writes.length === 3 && (hk.match(/jar\.write\((base|`\$\{base\}[^`]*`)\)/g) ?? []).length === 3)
  const browser = code.get('src/lib/privacy/browser.ts') ?? ''
  check('lib/privacy/browser.ts holds the ONE document.cookie assignment in the app', (browser.match(/document\.cookie\s*=/g) ?? []).length === 1)
  const direct = []
  for (const [f, c] of code) {
    if (f.startsWith('src/lib/privacy/')) continue
    if (/browserEnv\(/.test(c) && /cookies\??\.write\(/.test(c)) direct.push(f)
  }
  check('nobody who takes the browser environment calls its cookie writer — it is only ever handed to housekeeping.ts', direct.length === 0, direct.join(', '))
  const lc = code.get('src/components/privacy/LegacyCleanup.tsx') ?? ''
  check('LegacyCleanup runs cleanupLegacy(browserEnv()) in an effect and writes nothing itself',
    /useEffect/.test(lc) && /cleanupLegacy\(\s*browserEnv\(\)\s*\)/.test(lc) && !/document\.cookie/.test(lc))
}

section('code ↔ registry — the facts the page states come from the code')
{
  const cartTypes = code.get('src/lib/cart/types.ts') ?? ''
  const ttl = cartTypes.match(/CART_TTL_MS\s*=\s*([0-9 *]+)/)
  const ttlMs = ttl ? Function(`return ${ttl[1]}`)() : NaN
  const cart = R.STORAGE_REGISTRY.find((i) => i.id === 'cart')
  check('the cart\'s expiry in code is what the registry says (ttlHours)', ttlMs === cart.ttlHours * 3600 * 1000, `code ${ttlMs}ms vs ${cart.ttlHours}h`)
  check('and the sentence says it in every language',
    /(^|\D)8(\D|$)/.test(cart.keeps.he) && /(^|\D)8(\D|$)/.test(cart.keeps.en) && /(^|\D)8(\D|$)/.test(cart.keeps.ar))

  const nav = code.get('src/lib/nav/viewTransition.ts') ?? ''
  const cap = nav.match(/slice\(\s*-(\d+)\s*\)/)
  const navItem = R.STORAGE_REGISTRY.find((i) => i.id === 'nav-stack')
  check('the navigation history\'s cap in code is what the registry says',
    !!cap && LANGS.every((l) => navItem.what[l].includes(cap[1])), cap ? `code says ${cap[1]}` : 'no slice(-N) found')

  const lib = read('node_modules/@supabase/ssr/dist/main/utils/constants.js')
  const days = lib.match(/maxAge:\s*400\s*\*\s*24\s*\*\s*60\s*\*\s*60/)
  const session = R.STORAGE_REGISTRY.find((i) => i.id === 'auth-session')
  check('the sign-in cookie\'s defaults are still what the registry declares (path /, SameSite=Lax, 400 days, not HttpOnly)',
    /path:\s*"\/"/.test(lib) && /sameSite:\s*"lax"/.test(lib) && /httpOnly:\s*false/.test(lib) && !!days &&
    /Path=\//.test(session.attributes) && /SameSite=Lax/.test(session.attributes) &&
    /400 days/.test(session.attributes) && /not HttpOnly/.test(session.attributes) &&
    LANGS.every((l) => /400/.test(session.keeps[l])))
  check('this app passes no cookie options of its own to the Supabase clients',
    !/cookieOptions/.test(code.get('src/lib/supabase/client.ts') ?? '') && !/cookieOptions/.test(code.get('src/lib/supabase/server.ts') ?? '') &&
    !/cookieOptions/.test(code.get('src/middleware.ts') ?? ''))
}

// ───────────────────────────────────────────────────────────────────────────
section('nothing is loaded from another company')
{
  const ALLOWED_HOST = (h) => R.LINK_OUT_HOSTS.includes(h) || R.STAFF_ONLY_LINK_OUT_HOSTS.includes(h) ||
    h === 'www.w3.org' || h === 'localhost' ||
    h === '127.0.0.1' || h === 'ayeka.bar' || h.endsWith('.ayeka.bar')
  const stray = []
  const scan = (f, text) => {
    for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = m[1].replace(/\.$/, '')
      if (!ALLOWED_HOST(host)) stray.push(`${f}:${lineOf(text, m.index)} ${host}`)
    }
  }
  code.forEach((c, f) => scan(f, c))
  css.forEach((c, f) => scan(f, c))
  check('every host named in the source is ours, a declared link-out, or the SVG namespace', stray.length === 0,
    stray.slice(0, 4).join(' | ') + ' — a new host means a new disclosure on /cookies')

  const loaders = []
  const PATTERNS = [
    [/@import\s+(?:url\()?\s*['"]?https?:/g, 'remote @import'],
    [/<script\b[^>]*\bsrc\s*=/g, '<script src>'],
    [/<iframe\b/g, '<iframe>'],
    [/<link\b[^>]*\bhref\s*=\s*["']https?:/g, 'remote <link>'],
    [/<(?:img|video|audio|source)\b[^>]*\bsrc\s*=\s*["']https?:/g, 'remote media'],
    [/from\s+['"]next\/script['"]/g, 'next/script import'],
    [/navigator\.sendBeacon/g, 'sendBeacon'],
  ]
  const both = [...Array.from(code.entries()), ...Array.from(css.entries())]
  both.forEach(([f, c]) => PATTERNS.forEach(([re, label]) => {
    for (const m of c.matchAll(re)) loaders.push(`${f}:${lineOf(c, m.index)} ${label}`)
  }))
  check('no remote stylesheet, script, iframe, media, import or beacon anywhere in src/', loaders.length === 0, loaders.slice(0, 4).join(' | '))

  const globals = css.get('src/app/globals.css') ?? ''
  check('globals.css no longer imports Google Fonts', !/fonts\.googleapis|fonts\.gstatic|@import/.test(globals))
  const layout = code.get('src/app/layout.tsx') ?? ''
  check('the font is self-hosted through next/font (Rubik, hebrew + latin + arabic, applied on <html>)',
    /from\s+['"]next\/font\/google['"]/.test(layout) && /Rubik\(/.test(layout) &&
    /subsets:\s*\[[^\]]*['"]hebrew['"][^\]]*['"]latin['"][^\]]*['"]arabic['"]|subsets:\s*\[[^\]]*['"]arabic['"]/.test(layout) &&
    /variable:\s*['"]--font-rubik['"]/.test(layout) && /<html[^>]*className=\{[^}]*\.variable/.test(layout))
  check('the stylesheets use the self-hosted font variable',
    /font-family:\s*var\(--font-rubik\)/.test(globals) && /font-family:\s*var\(--font-rubik\)/.test(css.get('src/components/cart/cart.css') ?? ''))
}

// ───────────────────────────────────────────────────────────────────────────
section('the notice\'s memory — acknowledged once per inventory, never trusted blindly')
{
  const v = R.inventoryVersion()
  check('the inventory fingerprint is 8 hex characters', /^[0-9a-f]{8}$/.test(v))
  check('INVENTORY_VERSION in notice.ts is pinned to the registry\'s real fingerprint — change what the site stores and this must follow (everyone then sees the notice again)',
    N.INVENTORY_VERSION === v, `set INVENTORY_VERSION = '${v}' in src/lib/privacy/notice.ts (it is '${N.INVENTORY_VERSION}')`)
  check('it is deterministic and independent of order',
    v === R.inventoryVersion() && v === R.inventoryVersion(R.STORAGE_REGISTRY.slice().reverse()))
  const extra = { ...R.STORAGE_REGISTRY[0], id: 'x', name: 'ayeka.new.thing.v1' }
  check('it changes when something is added', R.inventoryVersion([...R.STORAGE_REGISTRY, extra]) !== v)
  check('it changes when a name or a category changes',
    R.inventoryVersion(R.STORAGE_REGISTRY.map((i, n) => (n === 0 ? { ...i, name: i.name + 'x' } : i))) !== v &&
    R.inventoryVersion(R.STORAGE_REGISTRY.map((i, n) => (n === 0 ? { ...i, category: 'functional' === i.category ? 'necessary' : 'functional' } : i))) !== v)
  check('it does NOT change when only the wording changes (a typo fix must not re-nag everyone)',
    R.inventoryVersion(R.STORAGE_REGISTRY.map((i) => ({ ...i, what: { he: 'x', en: 'x', ar: 'x' }, keeps: { he: 'y', en: 'y', ar: 'y' } }))) === v)

  check('a valid acknowledgement round-trips', same(N.parseAck(N.serializeAck('abcd1234', 1760000000000)), { v: 'abcd1234', at: 1760000000000 }))
  const garbage = [null, undefined, '', 'not json', '[]', 'null', '123', '"x"', '{}', '{"v":1,"at":2}', '{"v":"","at":2}',
    '{"v":"ok","at":"2"}', '{"v":"ok"}', '{"v":"ok","at":null}', `{"v":"${'x'.repeat(40)}","at":1}`, 'x'.repeat(300), '{"v":"ok","at":1e999}']
  check('garbage, wrong shapes and oversize values are all "not acknowledged"', garbage.every((g) => N.parseAck(g) === null))
  check('shown when never acknowledged', N.shouldShowNotice(null, v) === true)
  check('not shown when this exact inventory was acknowledged', N.shouldShowNotice({ v, at: 1 }, v) === false)
  check('shown again when the inventory has changed since', N.shouldShowNotice({ v: 'deadbeef', at: 1 }, v) === true)
}

function fakeStorage(initial = {}, throws = []) {
  const m = new Map(Object.entries(initial))
  const guard = (n) => { if (throws.includes(n)) throw new Error('blocked') }
  return {
    get length() { guard('length'); return m.size },
    clear() { guard('clear'); m.clear() },
    key(i) { guard('key'); return Array.from(m.keys())[i] ?? null },
    removeItem(k) { guard('removeItem'); m.delete(k) },
    keys: () => Array.from(m.keys()),
  }
}
function fakeJar(cookie, hostname) {
  const writes = []
  return { read: () => cookie, write: (c) => writes.push(c), hostname, writes }
}

section('delete-what-this-site-stored')
{
  const local = fakeStorage({ siteLanguage: 'en', 'ayeka.menu.cart.v1': '{}', negishot_sid: 'x' })
  const session = fakeStorage({ 'ayeka:navStack': '[]' })
  const jar = fakeJar('sb-abc-auth-token=secret; other=1', 'www.ayeka.bar')
  const r = H.clearDeviceStorage({ local, session, cookies: jar })
  check('it empties localStorage and sessionStorage and reports how many entries went', r.cleared === 4 && local.keys().length === 0 && session.keys().length === 0)
  check('it never touches cookies — signing someone out from a privacy page would be a surprise', jar.writes.length === 0)
  check('with nothing there it removes nothing and says so', H.clearDeviceStorage({ local: fakeStorage(), session: fakeStorage() }).cleared === 0)
  check('missing or null storage is fine', H.clearDeviceStorage({}).cleared === 0 && H.clearDeviceStorage({ local: null, session: null }).cleared === 0)
  let threw = false
  try { H.clearDeviceStorage({ local: fakeStorage({ a: '1' }, ['length', 'clear']), session: fakeStorage({ b: '2' }, ['clear']) }) } catch { threw = true }
  check('storage that throws (a private window) never breaks the page', !threw)
}

section('tidying leftovers of things the site no longer uses')
{
  const local = fakeStorage({
    siteLanguage: 'en', negishot_prefs_NGS_160D202C7B8B: '{}', negishot_sid: 'ns_x', 'ayeka.shifts.prototype.v1': '{}',
    'ayeka.shifts.prototype.v2': '{}', 'ayeka.a11y.prefs.v1': '{}',
  })
  const session = fakeStorage({ negishot_tmp: '1', 'ayeka:navStack': '[]' })
  const jar = fakeJar('negishot_prefs=%7B%7D; foo=bar; negishotX=1; sb-abc-auth-token=secret', 'www.ayeka.bar')
  const r = H.cleanupLegacy({ local, session, cookies: jar })
  check('it removes the old overlay\'s keys and the old demo format — adjacent keys included',
    same(local.keys().sort(), ['ayeka.a11y.prefs.v1', 'ayeka.shifts.prototype.v2', 'siteLanguage']) &&
    same(session.keys(), ['ayeka:navStack']) && r.storage.length === 4)
  check('it expires only the old overlay\'s cookies — never the sign-in cookie, never anyone else\'s',
    same(r.cookies.sort(), ['negishotX', 'negishot_prefs']) &&
    jar.writes.every((w) => /^negishot/.test(w) && /Max-Age=0/.test(w) && /Path=\//.test(w)))
  check('it tries the host-only and both domain forms (a script cannot see which one the cookie was set with)',
    jar.writes.filter((w) => /^negishot_prefs=/.test(w)).length === 3 &&
    jar.writes.some((w) => /Domain=www\.ayeka\.bar/.test(w)) && jar.writes.some((w) => /Domain=\.ayeka\.bar/.test(w)))
  const dev = fakeJar('negishot_prefs=1', 'localhost')
  H.cleanupLegacy({ cookies: dev })
  check('on localhost it writes no domain attribute (browsers refuse it there)', dev.writes.length === 1 && !/Domain=/.test(dev.writes[0]))
  const clean = H.cleanupLegacy({ local: fakeStorage({ siteLanguage: 'he' }), session: fakeStorage(), cookies: fakeJar('a=1', 'www.ayeka.bar') })
  check('with nothing to tidy it does nothing (nearly every visit)', clean.storage.length === 0 && clean.cookies.length === 0)
  let threw = false
  try { H.cleanupLegacy({ local: fakeStorage({ negishot_sid: '1' }, ['key']), session: fakeStorage({ negishot_a: '1' }, ['removeItem']), cookies: { read() { throw new Error('x') }, write() { throw new Error('y') }, hostname: 'a.b' } }) } catch { threw = true }
  check('storage and cookie access that throws never breaks the page', !threw)
  check('the legacy lists name what was actually left behind',
    H.isLegacyStorageKey('negishot_sid') && H.isLegacyStorageKey('negishot_prefs_NGS_160D202C7B8B') && H.isLegacyStorageKey('ayeka.shifts.prototype.v1') &&
    !H.isLegacyStorageKey('ayeka.shifts.prototype.v2') && !H.isLegacyStorageKey('siteLanguage') &&
    H.isLegacyCookieName('negishot_prefs') && !H.isLegacyCookieName('sb-x-auth-token'))
  check('nothing in the source still writes a legacy key (they are only ever removed)',
    !Array.from(code.entries()).some(([f, c]) => !f.startsWith('src/lib/privacy/') && /(setItem|getItem)\(\s*['"](negishot|ayeka\.shifts\.prototype\.v1)/.test(c)))
}

// ───────────────────────────────────────────────────────────────────────────
section('wiring — the page, the footer links, the notice, the cleanup')
{
  check('the /cookies route exists and is a server page that reads the owner\'s languages',
    exists('src/app/cookies/page.tsx') && /getSiteLanguages/.test(code.get('src/app/cookies/page.tsx') ?? '') &&
    /CookiesView/.test(code.get('src/app/cookies/page.tsx') ?? ''))
  const view = code.get('src/components/privacy/CookiesView.tsx') ?? ''
  check('the page is generated from the registry (every public category and the staff group), not retyped',
    /STORAGE_REGISTRY|itemsByCategory\(/.test(view) && /itemsByCategory\(\s*['"]necessary['"]/.test(view) &&
    /itemsByCategory\(\s*['"]functional['"]/.test(view) && /staffItems\(/.test(view) && /COOKIES_COPY/.test(view))
  check('the page lists the other companies it contacts (Vercel and Supabase) from the copy',
    /othersIntro|COOKIES_COPY\.others/.test(view) && C.COOKIES_COPY.others.some((o) => o.name === 'Vercel') && C.COOKIES_COPY.others.some((o) => o.name === 'Supabase'))
  check('deleting goes through the house confirm sheet (never window.confirm), with a translated cancel label',
    /ConfirmSheet/.test(view) && !/window\.confirm|\bconfirm\(/.test(view) && /cancelLabel/.test(view) && /cancelLabel/.test(code.get('src/components/ConfirmSheet.tsx') ?? ''))
  check('the delete action is announced (status role) and reloads so the widget and language reset',
    /role=["']status["']/.test(view) && /location\.reload\(\)/.test(view))

  for (const [file, name] of [['src/components/Portal.tsx', 'the portal'], ['src/components/MenuView.tsx', 'the menu']]) {
    const c = code.get(file) ?? ''
    check(`${name} links to the page from its footer, in every language, from the one shared label`,
      /COOKIES_PATH/.test(c) && /COOKIES_LINK_LABEL/.test(c))
    check(`${name} mounts the one-time notice`, /<StorageNotice\b/.test(c))
  }
  const layout = code.get('src/app/layout.tsx') ?? ''
  check('the layout mounts the leftover cleanup (so it runs on any first page, not only the portal)', /<LegacyCleanup\s*\/>/.test(layout))
  check('the notice is NOT mounted in the layout (it belongs to the two public entry pages only)', !/<StorageNotice\b/.test(layout))

  const notice = code.get('src/components/privacy/StorageNotice.tsx') ?? ''
  const noticeCss = css.get('src/components/privacy/privacy.css') ?? ''
  check('the notice is a non-modal region: portalled, labelled, never a dialog, never moves focus',
    /ModalPortal/.test(notice) && /role=["']region["']/.test(notice) && !/aria-modal|role=["'](?:alert)?dialog["']/.test(notice) && !/\.focus\(/.test(notice))
  check('it remembers by the declared key and the inventory fingerprint', /ACK_KEY/.test(notice) && /INVENTORY_VERSION/.test(notice) && /shouldShowNotice\(/.test(notice) && /parseAck\(/.test(notice))

  // The portal and the menu are the two most-visited pages; the root layout ships
  // with every page. None of what they load may import the heavy modules (the
  // registry's eleven trilingual entries, the page's copy). The first version did
  // and added 13 kB to both pages.
  const LIGHT = ['src/lib/privacy/notice.ts', 'src/lib/privacy/browser.ts', 'src/lib/privacy/housekeeping.ts',
    'src/components/privacy/StorageNotice.tsx', 'src/components/privacy/LegacyCleanup.tsx',
    'src/components/Portal.tsx', 'src/components/MenuView.tsx', 'src/app/layout.tsx']
  const heavyImports = []
  for (const f of LIGHT) {
    for (const m of (code.get(f) ?? '').matchAll(/import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/g)) {
      if (/(^|\/)privacy\/(registry|copy)$|^\.\/(registry|copy)$/.test(m[1])) heavyImports.push(`${f} → ${m[1]}`)
    }
  }
  check('nothing the portal, the menu or the layout loads imports the registry or the page copy (type-only imports are erased and allowed)',
    heavyImports.length === 0, heavyImports.join(' | '))
  check('it waits for the portal intro to finish (never shown over it)', /\.intro/.test(notice))
  const zNotice = (noticeCss.match(/\.storage-notice\s*\{[^}]*z-index:\s*(\d+)/) ?? [])[1]
  const zCart = (css.get('src/components/cart/cart.css') ?? '').match(/\.cart-fab-wrap\s*\{[^}]*z-index:\s*(\d+)/)?.[1]
  check('it sits under the cart button, the sheets and every modal (a notice never covers an action)',
    !!zNotice && !!zCart && Number(zNotice) < Number(zCart), `notice ${zNotice} vs cart ${zCart}`)
  check('it clears the accessibility button (48px + 16px) and honours reduced motion and print',
    /bottom:\s*calc\(env\(safe-area-inset-bottom[^)]*\)\s*\+\s*(8\d|9\d|1\d\d)px\)/.test(noticeCss) &&
    /prefers-reduced-motion/.test(noticeCss) && /a11y-motion-off/.test(noticeCss) && /@media print/.test(noticeCss))
  check('it does not animate an element that carries a backdrop-filter (BLUEPRINT motion law b)', !/backdrop-filter/.test(noticeCss))

  const linkClicks = []
  for (const [f, c] of code) for (const m of c.matchAll(/<Link\b[^>]*\bonClick\s*=/g)) linkClicks.push(`${f}:${lineOf(c, m.index)}`)
  check('no <Link> carries its own onClick — PageTransitions takes every link click in the capture phase, so the handler would silently never run',
    linkClicks.length === 0, linkClicks.join(', '))
  check('opening /cookies records the acknowledgement (the way "Details" and the footer link count as having seen the notice)',
    /acknowledgeNotice\(\)/.test(view) && /acknowledgeNotice/.test(code.get('src/lib/privacy/browser.ts') ?? '') &&
    /acknowledgeNotice\(\)/.test(notice))

  const mw = code.get('src/middleware.ts') ?? ''
  const access =(code.get('src/lib/staff/access.ts') ?? '') + (code.get('src/lib/shifts/access.ts') ?? '') + (code.get('src/lib/waiter/access.ts') ?? '')
  check('/cookies is public — not behind sign-in and not behind the loyalty switch',
    !/['"]\/cookies/.test(mw + access))

  const a11yPage = code.get('src/app/accessibility/page.tsx') ?? ''
  check('the accessibility statement no longer says the button is fixed in one corner — it can be moved or hidden, and it links here',
    /אפשר להעביר/.test(a11yPage) && /F2/.test(a11yPage) && /COOKIES_PATH|\/cookies/.test(a11yPage))
}

// ───────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
