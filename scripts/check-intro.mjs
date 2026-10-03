#!/usr/bin/env node
// Logic harness for the portal intro (src/lib/intro/ + src/components/intro/,
// plus the owner's switch: lib/settings/keys.ts, /api/owner/settings, /owner/intro).
//
//   node scripts/check-intro.mjs
//
// Same shape as check-languages.mjs: the pure rules (the words, the two
// timelines, which version a visitor gets, the switch's reader and time-box) run
// here from the REAL source. Because the intro is also a stylesheet and a few
// pieces of wiring, the contracts that cross those files — the ones that would
// otherwise drift silently — are checked too.
//
// WHAT IT IS ACTUALLY GUARDING
//   • The owner's Hebrew is exactly what the owner wrote.
//   • The SHORT version — the one on every refresh — is pinned to the numbers the
//     owner approved. The welcome may be tuned; the short one may not drift.
//   • Both versions finish inside their budget in every language.
//   • A device that cannot remember a first visit never gets the welcome on
//     every load.
//   • Timing lives in one place. The stylesheet reads exactly the custom
//     properties config.ts writes — for BOTH versions — no private numbers.
//   • It sits one notch UNDER the accessibility widget (read from the widget's
//     real source), and is never inside #a11y-scope or the page template — the
//     two ancestors that would break a `position: fixed` overlay.
//   • The owner's switch: only an explicit `false` turns it off, the row is
//     written public (or the portal silently ignores "off"), the cache is
//     busted, the route is owner-only, and reading it can never slow a page.
//   • The motion laws in BLUEPRINT §4.14 that can be checked statically.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

const outDir = join(tmpdir(), `ayeka-intro-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
async function load(rel, out) {
  writeFileSync(join(outDir, out), ts.transpileModule(read(rel), {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText)
  return import(pathToFileURL(join(outDir, out)).href)
}
const C = await load('src/lib/intro/config.ts', 'config.mjs')
const W = await load('src/lib/intro/copy.ts', 'copy.mjs')

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const LANGS = ['he', 'en', 'ar']
const VARIANTS = ['first', 'repeat']
const HEBREW = /[֐-׿]/
const ARABIC = /[؀-ۿ]/
const LATIN = /[A-Za-z]/

// ───────────────────────────────────────────────────────────────────────────
section('copy — every language has every line')
{
  check('exactly he / en / ar', same(Object.keys(W.INTRO_COPY).sort(), [...LANGS].sort()))
  for (const l of LANGS) {
    const c = W.INTRO_COPY[l]
    check(`${l}: headline, invitation and skip hint are all non-empty`,
      [c.line1, c.line2, c.skip].every((s) => typeof s === 'string' && s.trim().length > 0))
    check(`${l}: no leading/trailing space, no double spaces`,
      [c.line1, c.line2, c.skip].every((s) => s === s.trim() && !/\s{2,}/.test(s)))
  }
}

section('copy — the owner\'s Hebrew is exactly what the owner wrote')
{
  const strip = (s) => s.replace(/\*/g, '')
  check('headline', strip(W.INTRO_COPY.he.line1) === 'מוכנים להתחיל את חיי הלילה שלכם בחריש?')
  check('invitation', strip(W.INTRO_COPY.he.line2) === 'בואו לשתות קוקטיילים או לאכול ברמה הכי גבוהה שיש')
}

section('copy — each text is in the language of its slot')
{
  const he = W.INTRO_COPY.he, en = W.INTRO_COPY.en, ar = W.INTRO_COPY.ar
  check('he is Hebrew only', [he.line1, he.line2, he.skip].every((s) => HEBREW.test(s) && !ARABIC.test(s) && !LATIN.test(s)))
  check('en is Latin only', [en.line1, en.line2, en.skip].every((s) => LATIN.test(s) && !HEBREW.test(s) && !ARABIC.test(s)))
  check('ar is Arabic only', [ar.line1, ar.line2, ar.skip].every((s) => ARABIC.test(s) && !HEBREW.test(s) && !LATIN.test(s)))
}

section('copy — the highlight marker')
{
  for (const l of LANGS) {
    const c = W.INTRO_COPY[l]
    const stars = (s) => (s.match(/\*/g) || []).length
    check(`${l}: the headline marks exactly one word`,
      stars(c.line1) === 2 && W.splitLine(c.line1).filter((w) => w.hl).length === 1)
    check(`${l}: no marker leaks into the invitation or the hint`, stars(c.line2) === 0 && stars(c.skip) === 0)
    check(`${l}: no marker survives into what is drawn`,
      W.splitLine(c.line1).concat(W.splitLine(c.line2)).every((w) => w.text.indexOf('*') === -1))
  }
}

section('splitLine — one animated unit per word')
{
  const t = (s) => W.splitLine(s).map((w) => w.text)
  check('punctuation stays on its word — the question mark is never stranded',
    t('בחריש?').length === 1 && t('בחריש?')[0] === 'בחריש?' && t('a b c?').join('|') === 'a|b|c?')
  check('Arabic question mark stays too', t('في حريش؟').join('|') === 'في|حريش؟')
  check('markers are stripped and flag the word', (() => {
    const w = W.splitLine('your *nightlife* in')
    return w.length === 3 && w[1].text === 'nightlife' && w[1].hl === true && w[0].hl === false && w[2].hl === false
  })())
  check('extra spaces never make an empty word', t('  a   b  ').join('|') === 'a|b')
  check('an empty line is no words', t('').length === 0 && t('   ').length === 0)
  check('a stray marker on its own is not a word', t('a * b').join('|') === 'a|b')
  check('a marker with punctuation after it still flags the word', (() => {
    const w = W.splitLine('*night*?')
    return w.length === 1 && w[0].text === 'night?' && w[0].hl
  })())
  for (const l of LANGS) {
    const words = W.splitLine(W.INTRO_COPY[l].line1).concat(W.splitLine(W.INTRO_COPY[l].line2))
    check(`${l}: no word is long enough to overflow a narrow phone`, words.every((w) => w.text.length <= 20))
  }
}

// ───────────────────────────────────────────────────────────────────────────
section('where it plays')
{
  check('the portal', C.isIntroPath('/') === true)
  check('NOT the menu — a table\'s QR code lands there and wants the menu now', C.isIntroPath('/menu') === false)
  check('NOT the owner or staff areas', ['/owner/dashboard', '/owner', '/owner/intro', '/staff/dashboard', '/login'].every((p) => C.isIntroPath(p) === false))
  check('NOT a lookalike path', ['/menu/', '//', '/ ', '/index'].every((p) => C.isIntroPath(p) === false))
  check('no path at all is not a path', [null, undefined, ''].every((p) => C.isIntroPath(p) === false))
  check('the list is exactly the portal', same(C.INTRO_PATHS, ['/']))
}

// ───────────────────────────────────────────────────────────────────────────
section('which version a visitor gets — the welcome once, the short one after')
{
  const P = C.pickVariant
  check('a device that has never seen it, and can remember, gets the welcome',
    P({ forced: null, seen: false, canRemember: true }).variant === 'first')
  check('…and that is a real visit, not a preview', P({ forced: null, seen: false, canRemember: true }).preview === false)
  check('a device that has seen it gets the short one', P({ forced: null, seen: true, canRemember: true }).variant === 'repeat')
  check('a device that CANNOT remember gets the short one, every time — never the welcome on every load',
    P({ forced: null, seen: false, canRemember: false }).variant === 'repeat')
  check('…even if it somehow reports having seen it', P({ forced: undefined, seen: true, canRemember: false }).variant === 'repeat')
  check('?intro=first plays the welcome as a PREVIEW, whatever the device has seen',
    [true, false].every((seen) => [true, false].every((cr) => {
      const r = P({ forced: 'first', seen, canRemember: cr }); return r.variant === 'first' && r.preview === true
    })))
  check('?intro=repeat plays the short one as a PREVIEW, whatever the device has seen',
    [true, false].every((seen) => [true, false].every((cr) => {
      const r = P({ forced: 'repeat', seen, canRemember: cr }); return r.variant === 'repeat' && r.preview === true
    })))
  check('anything else in ?intro= is ignored — it cannot select a version, force a preview, or break the rules',
    ['banana', '', 'FIRST', 'first ', 'both', '1', '__proto__'].every((f) =>
      P({ forced: f, seen: false, canRemember: true }).variant === 'first' && P({ forced: f, seen: false, canRemember: true }).preview === false))
  check('only exactly two versions exist', same(Object.keys(C.INTRO_TIMINGS).sort(), ['first', 'repeat']))
  check('the marker key is namespaced and versioned', /^ayeka\.intro\.seen\.v\d+$/.test(C.INTRO_SEEN_KEY))
}

// ───────────────────────────────────────────────────────────────────────────
section('the SHORT version is exactly what the owner approved — it must never drift')
{
  const R = C.INTRO_TIMINGS.repeat
  const approved = {
    litMs: 900,
    rule: { atMs: 200, ms: 460 },
    glint: { atMs: 420, ms: 950 },
    line1: { atMs: 150, stepMs: 55, wordMs: 560 },
    line2: { atMs: 640, stepMs: 32, wordMs: 520 },
    hint: { atMs: 1100, ms: 600 },
    holdMs: 650,
    exit: { delayMs: 100, ms: 560, stageMs: 520, passAtMs: 280 },
  }
  for (const k of Object.keys(approved)) check(`repeat.${k} is unchanged`, same(R[k], approved[k]))
  check('the shared skip, settle and failsafe are unchanged',
    C.INTRO_SKIP_MS === 260 && C.INTRO_SETTLE.quietMs === 90 && C.INTRO_SETTLE.maxMs === 450 && C.INTRO_FAILSAFE_MS === 4000)
  check('the short version has no turn and no sparkles', R.turnMs === 0 && R.sparkMs === 0)
  check('it still finishes in under three seconds in every language', LANGS.every((l) => {
    const c = W.INTRO_COPY[l]
    return C.planTimeline(W.splitLine(c.line1).length, W.splitLine(c.line2).length, 'repeat').doneAtMs <= 3000
  }))
  check('with no version named, the plan is the SHORT one (the safe default)',
    C.planTimeline(7, 9).doneAtMs === C.planTimeline(7, 9, 'repeat').doneAtMs
    && same(C.introCssVars(), C.introCssVars('repeat')))
}

section('timeline — both versions, every language, inside their budget')
{
  const plans = {}
  for (const v of VARIANTS) {
    const T = C.INTRO_TIMINGS[v]
    plans[v] = {}
    for (const l of LANGS) {
      const c = W.INTRO_COPY[l]
      const p = C.planTimeline(W.splitLine(c.line1).length, W.splitLine(c.line2).length, v)
      plans[v][l] = p
      check(`${v}/${l}: done in ${p.doneAtMs}ms, inside the ${C.INTRO_BUDGET_MS[v]}ms budget`, p.doneAtMs <= C.INTRO_BUDGET_MS[v], `${p.doneAtMs}ms`)
      check(`${v}/${l}: the exit starts after the last word has landed, with a hold`,
        p.exitAtMs >= p.textEndMs + T.holdMs && p.textEndMs > 0)
      check(`${v}/${l}: removal waits for the whole fade`, p.doneAtMs >= p.exitAtMs + T.exit.delayMs + T.exit.ms)
    }
    check(`${v}: a longer translation runs longer — the exit follows the text, it cannot cut it off`,
      C.planTimeline(9, 12, v).exitAtMs > C.planTimeline(7, 8, v).exitAtMs)
    check(`${v}: a shorter one never makes it end before the first word has even arrived`,
      C.planTimeline(1, 1, v).textEndMs >= T.line1.atMs + T.line1.wordMs)
    check(`${v}: zero words does not break it`, Number.isFinite(C.planTimeline(0, 0, v).doneAtMs))
    check(`${v}: the overlay stops catching taps before it is gone`, T.exit.passAtMs < T.exit.delayMs + T.exit.ms)
    check(`${v}: the content leaves inside the overlay's own fade`, T.exit.stageMs <= T.exit.delayMs + T.exit.ms)
    check(`${v}: the hint is late enough to read the brand first, early enough to be useful`,
      T.hint.atMs >= 600 && T.hint.atMs + T.hint.ms < plans[v].he.exitAtMs)
    check(`${v}: the glint comes after the coin has started to light, and finishes before the words leave`,
      T.glint.atMs > 0 && T.glint.atMs + T.glint.ms < plans[v].he.exitAtMs)
    check(`${v}: every duration is a non-negative finite number`, (() => {
      const nums = []
      const walk = (o) => { for (const x of Object.values(o)) typeof x === 'object' ? walk(x) : nums.push(x) }
      walk(T)
      return nums.every((n) => Number.isFinite(n) && n >= 0)
    })())
  }
  check('the short version\'s sub-line starts before its headline has finished — the eye is already moving',
    C.INTRO_TIMINGS.repeat.line2.atMs < C.INTRO_TIMINGS.repeat.line1.atMs + 6 * C.INTRO_TIMINGS.repeat.line1.stepMs + C.INTRO_TIMINGS.repeat.line1.wordMs)

  // The point of having two.
  const ratio = plans.first.he.doneAtMs / plans.repeat.he.doneAtMs
  check(`the welcome is meaningfully longer than the short one (${ratio.toFixed(2)}×)`, ratio >= 1.5)
  check('…but still short enough to be a welcome and not a wait — under six seconds in every language',
    LANGS.every((l) => plans.first[l].doneAtMs <= 6000))
  check('the welcome gives the coin a beat alone before any word', C.INTRO_TIMINGS.first.line1.atMs >= 800)
  check('the welcome shows the way out EARLIER than the short one — a first-timer needs it most',
    C.INTRO_TIMINGS.first.hint.atMs >= C.INTRO_TIMINGS.repeat.hint.atMs && C.INTRO_TIMINGS.first.hint.atMs < C.INTRO_TIMINGS.first.line2.atMs + 400)
  check('the welcome\'s coin turn finishes before its headline is over', C.INTRO_TIMINGS.first.turnMs <= plans.first.he.textEndMs)

  check('skipping is fast — under 400ms to gone', C.INTRO_SKIP_MS < 400)
  check('the failsafe is long enough for a slow phone, short enough never to trap anyone',
    C.INTRO_FAILSAFE_MS >= 3000 && C.INTRO_FAILSAFE_MS <= 6000)
  check('the language/motion settle wait is short and capped',
    C.INTRO_SETTLE.quietMs <= 150 && C.INTRO_SETTLE.maxMs <= 600 && C.INTRO_SETTLE.maxMs > C.INTRO_SETTLE.quietMs)
}

section('the welcome\'s sparkles')
{
  const S = C.INTRO_SPARKLES
  const T = C.INTRO_TIMINGS.first
  check('a handful — enough to read as a sparkle, few enough to stay a detail', S.length >= 5 && S.length <= 9)
  check('each hugs the rim and the halo: outside the coin, never out in the room',
    S.every((s) => { const r = Math.hypot(s.x, s.y); return r >= 0.55 && r <= 0.8 }))
  check('none can reach a screen edge (the narrowest phone\'s coin is ~150px in a 280px screen)',
    S.every((s) => Math.abs(s.x) <= 0.8 && Math.abs(s.y) <= 0.8))
  check('each is small, in coin-lengths, so the group scales with the coin', S.every((s) => s.k >= 0.03 && s.k <= 0.1))
  check('none sits over the headline\'s column: the lowest are off to the sides of the neon rule, not under it',
    S.filter((s) => s.y > 0.5).every((s) => Math.abs(s.x) >= 0.3))
  check('they catch one after another, in order — a twinkle, not a flash', S.every((s, i) => i === 0 || s.atMs > S[i - 1].atMs))
  check('the first catches before the first word arrives, so the coin is never just sitting there',
    S[0].atMs < T.line1.atMs)
  check('the last has faded before the exit begins, in every language', LANGS.every((l) => {
    const c = W.INTRO_COPY[l]
    return C.sparklesEndMs('first') < C.planTimeline(W.splitLine(c.line1).length, W.splitLine(c.line2).length, 'first').exitAtMs
  }))
  check('each twinkle is long enough to read and short enough to be a catch of light', T.sparkMs >= 600 && T.sparkMs <= 1600)
}

// ───────────────────────────────────────────────────────────────────────────
section('the owner\'s switch — the stored value')
{
  const N = C.normalizeIntroEnabled
  check('an explicit false turns it off', N(false) === false)
  check('an explicit true keeps it on', N(true) === true)
  check('no row at all (undefined) keeps it ON — the intro is a decoration the owner asked for',
    N(undefined) === true && N(null) === true)
  check('a hand-edited row cannot switch it off by accident: "false", 0, "", "off", {}, [] all stay ON',
    ['false', 0, '', 'off', 'no', {}, [], NaN].every((v) => N(v) === true))
  const keys = read('src/lib/settings/keys.ts')
  check('the key and its default live in keys.ts, and the default agrees with the normalizer',
    /export const INTRO_ENABLED = 'intro_enabled'/.test(keys)
    && /export const INTRO_ENABLED_DEFAULT = true/.test(keys) && N(undefined) === true)
  check('the reasoning is written on the constant (fails open — and why — and that the row must be public)',
    /FAILS OPEN/.test(keys) && /Public read/.test(keys) && /No migration/.test(keys))
  const server = read('src/lib/settings/server.ts')
  check('the reader is the same tagged, cached read as every other switch, and normalizes what it finds',
    /export async function getIntroEnabled\(\)[^}]*normalizeIntroEnabled\(await readSetting<unknown>\(INTRO_ENABLED, INTRO_ENABLED_DEFAULT\)\)/.test(server))
}

section('the owner\'s switch — reading it can never slow a page')
{
  const W2 = C.withTimeout
  const timersNow = () => (process.getActiveResourcesInfo ? process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length : 0)
  const base = timersNow()
  check('a fast read wins', (await W2(Promise.resolve(false), 500, true)) === false)
  check('…and leaves NO timer running behind it', timersNow() === base)
  check('a read that hangs gives up and shows the intro (the default), after about the timeout', await (async () => {
    const t0 = Date.now()
    const v = await W2(new Promise(() => {}), 60, true)
    const dt = Date.now() - t0
    return v === true && dt >= 50 && dt < 400
  })())
  check('a slow-but-eventually-fine read is not waited for past the timeout', await (async () => {
    let slow
    const v = await W2(new Promise((r) => { slow = setTimeout(() => r(false), 300) }), 40, true)
    clearTimeout(slow) // this test's own timer — don't let it pose as a leak in the next check
    return v === true
  })())
  check('a read that throws falls back, never rejects', await (async () => {
    try { return (await W2(Promise.reject(new Error('boom')), 500, true)) === true } catch { return false }
  })())
  check('…and clears its timer then too', timersNow() === base)
  check('the page waits no longer than a second and a half for a decoration',
    C.INTRO_GATE_TIMEOUT_MS <= 2000 && C.INTRO_GATE_TIMEOUT_MS >= 500)
}

section('the owner\'s switch — the gate, the API, the page, the tile')
{
  const gate = read('src/components/intro/IntroGate.tsx')
  check('IntroGate is a SERVER component (no "use client") — the switch is decided in the HTML, so there is no dark flash for an owner who turned it off',
    !/['"]use client['"]/.test(gate) && /export default async function IntroGate/.test(gate))
  check('it time-boxes the read and falls back to the switch\'s own default',
    /withTimeout\(getIntroEnabled\(\), INTRO_GATE_TIMEOUT_MS, INTRO_ENABLED_DEFAULT\)/.test(gate))
  check('it renders the overlay only when the switch is on, and nothing otherwise', /enabled \? <Intro \/> : null/.test(gate))

  const route = read('src/app/api/owner/settings/route.ts')
  const patch = route.slice(route.indexOf('export async function PATCH'))
  const branch = patch.slice(patch.indexOf("if (body && 'introEnabled' in body) {"), patch.indexOf("if (body && 'siteLanguages' in body) {"))
  check('the PATCH is owner-only: requireOwner() is the first thing it does',
    /export async function PATCH\(request: NextRequest\) \{\s*const auth = await requireOwner\(\)\s*if \(!auth\.ok\) return auth\.res/.test(patch))
  check('the intro branch exists', branch.length > 100)
  check('it accepts a bare boolean and refuses anything else', /typeof body\.introEnabled !== 'boolean'/.test(branch) && /status: 400/.test(branch))
  check('it writes the row PUBLIC — or the signed-out portal would silently ignore the owner\'s "off"',
    /key: INTRO_ENABLED/.test(branch) && /is_public: true/.test(branch))
  check('it busts the settings cache tag, so the next load of any page reflects the flip', /revalidateTag\(SETTINGS_TAG\)/.test(branch))
  check('it records who flipped it', /updated_by: auth\.userId/.test(branch))
  check('the GET returns it too, defaulting ON when there is no row',
    /introEnabled: introRow \? normalizeIntroEnabled\(introRow\.value\) : INTRO_ENABLED_DEFAULT/.test(route))

  const access = read('src/lib/staff/access.ts')
  const ops = access.slice(access.indexOf('OP_ONLY_PREFIXES = ['), access.indexOf(']', access.indexOf('OP_ONLY_PREFIXES = [')))
  check('/owner/intro is OP-only in the middleware\'s list (same as the other portal-wide settings)', /'\/owner\/intro'/.test(ops))

  const page = read('src/app/owner/intro/page.tsx')
  check('the page re-checks OP server-side (middleware is the first gate, not the only one)',
    /if \(!user\) redirect\('\/login'\)/.test(page) && /if \(!isOp\(me\)\) redirect\('\/no-access'\)/.test(page))
  check('the page reads the switch and shows the real lengths from the real timeline',
    /getIntroEnabled\(\)/.test(page) && /planTimeline\(/.test(page) && /<IntroCard initial=\{enabled\}/.test(page))
  const dash = read('src/app/owner/dashboard/page.tsx')
  check('the dashboard has a tile for it', /<Link href="\/owner\/intro" style=\{navCard\}>/.test(dash) && /מסך פתיחה/.test(dash))

  const cardSrc = read('src/components/IntroCard.tsx')
  // Code only: the card's own comments name `<Link>` and `disabled` while
  // explaining why it uses neither.
  const card = cardSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('the card is a real switch: role="switch", aria-checked, saves on tap, optimistic with rollback',
    /role="switch"/.test(card) && /aria-checked=\{on\}/.test(card) && /introEnabled: !before/.test(card) && /setOn\(before\)/.test(card))
  check('it PATCHes the one settings route', /fetch\('\/api\/owner\/settings', \{\s*method: 'PATCH'/.test(card))
  check('the busy guard is not `disabled` (that would drop keyboard focus — WCAG 2.4.3)',
    /aria-disabled=\{busy\}/.test(card) && !/(?<!aria-)disabled=\{busy\}/.test(card))
  const hrefs = Array.from(card.matchAll(/href="\/\?intro=([a-z]+)"/g)).map((m) => m[1])
  check('it has a preview link for each version', same(hrefs.sort(), ['first', 'repeat']))
  check('…and each preview parameter is one the intro actually accepts, as a PREVIEW',
    hrefs.every((p) => C.pickVariant({ forced: p, seen: true, canRemember: true }).preview === true))
  check('the preview links are plain <a data-no-transition> — a client-side navigation would swallow the intro (the layout survives it)',
    (card.match(/<a href="\/\?intro=[a-z]+" data-no-transition/g) || []).length === 2 && !/<Link/.test(card))
  check('the previews are offered only while it is on (there is nothing to preview otherwise)', /\{on \? \(/.test(card))
}

// ───────────────────────────────────────────────────────────────────────────
section('the page replay')
{
  const R = C.INTRO_REPLAY
  check('it names the portal\'s own staggered elements, by the codebase\'s existing convention',
    R.selector === '#main [style*="rise-in"]')
  check('it is quick enough to finish just after the overlay has', R.atMs + 6 * R.stepMs + R.durationMs < 1600)
  const portal = read('src/components/Portal.tsx')
  check('the portal still renders <main id="main">', /<main id="main"/.test(portal))
  check('the portal still animates its blocks inline with rise-in (what the selector matches)',
    (portal.match(/animation: `rise-in/g) || []).length >= 4)
}

// ───────────────────────────────────────────────────────────────────────────
section('stylesheet ↔ config — one source for every number, for BOTH versions')
const css = read('src/components/intro/intro.css')
{
  const first = Object.keys(C.introCssVars('first')).sort()
  const repeat = Object.keys(C.introCssVars('repeat')).sort()
  check('both versions provide the SAME variables — switching version at the start of the show only ever changes values',
    same(first, repeat))
  const used = Array.from(new Set((css.match(/var\((--intro-[a-z0-9-]+)\)/g) || []).map((m) => m.slice(4, -1)))).sort()
  const missing = used.filter((v) => first.indexOf(v) === -1)
  const unused = first.filter((v) => used.indexOf(v) === -1)
  check('every variable the stylesheet reads is provided by config.ts', missing.length === 0, missing.join(', '))
  check('every variable config.ts provides is read by the stylesheet', unused.length === 0, unused.join(', '))
  check('every provided value, in both versions, is a plain millisecond number',
    VARIANTS.every((v) => Object.values(C.introCssVars(v)).every((x) => /^\d+ms$/.test(x))))
  check('the stylesheet defines none of them itself (no private copy of a number)',
    !/--intro-[a-z0-9-]+\s*:/.test(css))
  check('the two versions genuinely differ where the welcome is meant to differ',
    C.introCssVars('first')['--intro-lit'] !== C.introCssVars('repeat')['--intro-lit']
    && C.introCssVars('first')['--intro-turn'] !== '0ms' && C.introCssVars('repeat')['--intro-turn'] === '0ms')
  const tsx = read('src/components/intro/Intro.tsx')
  check('provided from the component onto the overlay — the server renders the short one\'s, the welcome\'s arrive with the show',
    /introCssVars\('first'\)/.test(tsx) && /introCssVars\('repeat'\)/.test(tsx) && /style=\{VARS\[variant \?\? 'repeat'\]\}/.test(tsx))
}

section('stylesheet — z-order against the accessibility widget')
{
  const ours = Number((css.match(/\.intro\s*\{[^}]*?z-index:\s*(\d+)/s) || [])[1])
  const widgetSrc = read('node_modules/a11y-widget/src/internal/style.ts')
  const theirs = (widgetSrc.match(/z-index:\s*(\d+)/g) || []).map((m) => Number(m.replace(/\D/g, '')))
  check('found the overlay\'s z-index', Number.isFinite(ours) && ours > 0)
  check('found the widget\'s z-indexes in its real source', theirs.length >= 2, `${theirs.length} found`)
  check(`the overlay (${ours}) sits UNDER the widget's lowest (${Math.min(...theirs)}) — a decoration must never hide the way into accessibility`,
    ours < Math.min(...theirs))
  check('…and above every sheet and bar the app itself draws', ours > 1000)
}

section('stylesheet — the motion laws that can be checked statically (BLUEPRINT §4.14)')
{
  const block = (selector) => {
    const i = css.indexOf(`${selector} {`)
    if (i === -1) return null
    return css.slice(i, css.indexOf('}', i) + 1)
  }
  // Code only — the stylesheet's own header comments name the property while
  // explaining the rule, and must not trip it.
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '')
  check('(b) no backdrop-filter anywhere', !/backdrop-filter/.test(cssCode))
  for (const sel of ['.intro-coin', '.intro-halo', '.intro-copy', '.intro-spark']) {
    const b = block(sel)
    check(`(d) ${sel} is placed with left/top, not transform`, b !== null && /left:/.test(b) && !/transform/.test(b))
  }
  check('the turn STARTS face-on — the standby coin is face-on, so a tilted first frame would snap the coin the instant it lit',
    /@keyframes intro-coin-turn \{\s*0%\s*\{ transform: perspective\(900px\) rotateY\(0deg\);/.test(css)
    && /100% \{ transform: perspective\(900px\) rotateY\(0deg\); \}/.test(css))
  check('(d) the coin\'s animated transforms are on its FACE and its <img>, never on the positioned box',
    /\.intro\[data-lit\] \.intro-coin img \{ animation: intro-coin-on/.test(css)
    && /\.intro\[data-variant="first"\] \.intro-coin-face \{\s*animation: intro-coin-turn/.test(css)
    && !/\.intro-coin \{[^}]*animation/.test(css))
  check('the glint rides on the same face as the image, so the light never slides off a turning coin',
    /\.intro-coin-face \{ position: absolute; inset: 0; \}/.test(css) && /<div className="intro-coin-face">[\s\S]*?<img[\s\S]*?<span className="intro-glint" \/>[\s\S]*?<\/div>/.test(read('src/components/intro/Intro.tsx')))
  check('the sparkle\'s glow is on a wrapper and its shape on ::before — `filter` runs BEFORE `clip-path`, so a glow on the clipped element would be cut off',
    /\.intro-spark \{[^}]*filter: drop-shadow/.test(css) && /\.intro-spark::before \{[^}]*clip-path: polygon/.test(css))
  const tsx = read('src/components/intro/Intro.tsx')
  check('(c) the state attributes are only ever turned ON — never back off',
    !/setLit\(false\)|setExit\(null\)|setPass\(false\)|setArmed\(false\)|setVariant\(null\)/.test(tsx))
  check('(c) the show is keyed to attributes that stay, so no animation is switched off and on again',
    ['data-lit', 'data-out', 'data-skip', 'data-variant="first"'].every((a) => css.indexOf(`.intro[${a}]`) !== -1))
  check('(c) the version is set in the SAME commit as the language and the attribute that starts the show',
    /setLang\(l\)\s*setVariant\(v\)\s*setLit\(true\)/.test(tsx))
  check('the failsafe exists, is armed by default and disarmed by the component',
    /animation: intro-failsafe/.test(css) && /\.intro\[data-armed\] \{ animation: none; \}/.test(css) && /data-armed=/.test(tsx))
  check('[data-out]/[data-skip] come AFTER [data-armed] — they win on source order',
    css.indexOf('.intro[data-armed]') < css.indexOf('.intro[data-out]') && css.indexOf('.intro[data-armed]') < css.indexOf('.intro[data-skip]'))
}

section('stylesheet — it is sized for the screen it is on')
{
  check('a real-monitor tier exists, so a big screen is not left with a phone-sized coin',
    /@media \(min-width: 1024px\) and \(min-height: 640px\)/.test(css))
  check('…and it needs BOTH a wide AND a tall screen, so a landscape phone (844×390) never lands in it',
    !/@media \(min-width: 1024px\) \{/.test(css))
  check('sizes follow the SHORTER dimension as well as the width — landscape is the viewport that overflows first',
    /--coin: min\(54vw, 34vh, 224px\)/.test(css) && /min\(6\.2vw, 5\.2vh\)/.test(css))
  check('the dynamic-viewport (iOS toolbar) variants are provided where the vh ones are',
    /@supports \(height: 1dvh\)/.test(css) && /34dvh/.test(css) && /5\.2dvh/.test(css))
  check('Arabic never gets letter-spacing — it breaks the joins', /\.intro-copy\[lang="ar"\] \.intro-line \{ letter-spacing: 0; \}/.test(css))
}

section('stylesheet — reduced motion substitutes, it does not remove (BLUEPRINT §4.13)')
{
  const i = css.indexOf('@media (prefers-reduced-motion: reduce)')
  check('there is a reduced-motion block', i !== -1)
  const rm = i === -1 ? '' : css.slice(i, css.indexOf('/* The accessibility widget', i))
  for (const sel of ['.intro-glint', '.intro-coin img', '.intro-halo', '.intro-rule', '.intro-l1 .intro-w', '.intro-l2 .intro-w', '.intro-stage', '.intro-spark', '.intro-coin-face']) {
    check(`it covers ${sel}`, rm.indexOf(sel) !== -1)
  }
  check('the welcome\'s turn and sparkles — pure movement — are off under reduced motion',
    /\.intro-spark \{ display: none; \}/.test(rm) && /\.intro\[data-variant="first"\] \.intro-coin-face \{ animation: none; \}/.test(rm))
  check('its keyframes are opacity/filter only — no transform, no blur travel',
    (() => { const k = rm.match(/@keyframes[^{]+\{[^@]*?\}\s*\}/gs) || []; return k.length >= 4 && k.every((x) => !/transform|blur\(/.test(x)) })())
  check('the words arrive a line at a time (no per-word stagger) under reduced motion',
    /intro-l1 \.intro-w \{[^}]*animation-delay: var\(--intro-l1-at\)/.test(rm) && /intro-l2 \.intro-w \{[^}]*animation-delay: var\(--intro-l2-at\)/.test(rm))
  check('it is NOT a blanket kill — nothing here says animation: none !important', !/animation:\s*none\s*!important/.test(css))
  check('the accessibility widget\'s "pause animations" hides it', /html\.a11y-motion-off \.intro \{ display: none !important; \}/.test(css))
  check('it never prints', /@media print \{ \.intro \{ display: none !important; \} \}/.test(css))
}

section('wiring — where it is mounted, and how it decides')
{
  const layout = read('src/app/layout.tsx')
  const scopeStart = layout.indexOf('<div id="a11y-scope">')
  const scopeEnd = layout.indexOf('</div>', scopeStart)
  const inScope = layout.slice(scopeStart, scopeEnd)
  check('layout imports and renders <IntroGate />', /import IntroGate from '@\/components\/intro\/IntroGate'/.test(layout) && /<IntroGate \/>/.test(layout))
  check('it is NOT inside #a11y-scope (a CSS filter there would become its containing block)', scopeStart !== -1 && inScope.indexOf('Intro') === -1)
  check('it comes after #a11y-scope in the layout', layout.indexOf('<IntroGate />') > scopeEnd)
  check('the layout itself stays a plain synchronous component — the read lives in the gate',
    /export default function RootLayout/.test(layout) && !/async function RootLayout/.test(layout))
  check('it is not mounted in the page template either', read('src/app/template.tsx').indexOf('Intro') === -1)

  const tsx = read('src/components/intro/Intro.tsx')
  check('it is decorative: aria-hidden, and nothing in it can take focus',
    /aria-hidden="true"/.test(tsx) && !/tabIndex|<button|<a\s|<input/.test(tsx))
  check('the decision to play is made once, not re-read on every navigation',
    /useState\(\(\) => isIntroPath\(pathname\)\)/.test(tsx))
  check('it listens for taps on the overlay itself (not window), so the widget above it stays usable',
    /root\.addEventListener\('pointerdown'/.test(tsx))
  check('a bare modifier, a shortcut chord, or a keydown that names no key never counts as a skip',
    /e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey \|\| IGNORED_KEYS\.indexOf\(e\.key\) !== -1/.test(tsx) &&
    ['Shift', 'Control', 'Alt', 'Meta', 'Unidentified'].every((k) => tsx.indexOf(`'${k}'`) !== -1))
  check('a skip does not hand the tap to the page beneath: only the NATURAL exit ever makes the overlay click-through',
    // On touch, the click that follows a tap goes to whatever is under the finger
    // when it lifts — so the skip path must keep catching taps until it is gone.
    (tsx.match(/setPass\(true\)/g) || []).length === 1 && /if \(how === 'out'\) \{[^}]*setPass\(true\)/.test(tsx))
  check('it restores page scrolling when it goes — in the effect cleanup', /classList\.remove\('intro-lock'\)/.test(tsx))
  check('it honours the widget\'s pause-animations class', /a11y-motion-off/.test(tsx))
  check('it does not play in a tab nobody is looking at (a link opened in the background, a prerender)',
    /document\.visibilityState === 'hidden'/.test(tsx))
  check('it does not play after the CSS failsafe has already put it away (script came very late)',
    /shown\.visibility === 'hidden'/.test(tsx))
  check('the logo is the portal\'s own stable path, so real artwork swaps in untouched', /src="\/assets\/logo\.svg"/.test(tsx))
}

section('wiring — the first-visit marker')
{
  const tsx = read('src/components/intro/Intro.tsx')
  const fn = tsx.slice(tsx.indexOf('function chooseVariant()'), tsx.indexOf('/** One span per word'))
  check('the version is chosen INSIDE the settle callback — at the moment the show starts, not at mount',
    /whenSettled\([\s\S]*?chooseVariant\(\)[\s\S]*?setLit\(true\)/.test(tsx))
  check('the marker is written when the show STARTS — so an impatient refresh or an early skip never earns the long one again',
    /setItem\(INTRO_SEEN_KEY/.test(fn) && /if \(!seen\) window\.localStorage\.setItem/.test(fn))
  check('a preview returns BEFORE any storage is touched — previewing never uses up a real first visit',
    fn.indexOf("pickVariant({ forced, seen: false, canRemember: false })") !== -1
    && fn.indexOf("pickVariant({ forced, seen: false, canRemember: false })") < fn.indexOf('localStorage'))
  check('a write that throws means "cannot remember" — which gets the SHORT version, never the welcome every load',
    /catch \{\s*canRemember = false/.test(fn))
  check('the marker is read through the shared key constant, not a private string',
    /INTRO_SEEN_KEY/.test(fn) && !/'ayeka\.intro/.test(tsx))
  check('the exit uses the chosen version\'s own timings', /let timing = INTRO_TIMINGS\.repeat/.test(tsx) && /timing = INTRO_TIMINGS\[v\]/.test(tsx))
  check('sparkles render for the welcome only', /variant === 'first' && INTRO_SPARKLES\.map/.test(tsx))
  check('the version is exposed as an attribute for the stylesheet', /data-variant=\{variant \?\? undefined\}/.test(tsx))
}

section('no test scaffolding left behind')
{
  // Verifying this feature means TEMPORARY edits (a bypassed visibility guard, a
  // throwaway cache-busting route, a frozen hold time) — every one is tagged
  // `TEMP-VERIFY`. A tagged line left in the tree must fail loudly rather than
  // ship, so this scans the real source for the tag. (This file is excluded: it
  // has to contain the tag to look for it.)
  const { readdirSync, statSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const hits = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx|mjs|js|css|json)$/.test(name) || name === 'check-intro.mjs') continue
      if (readFileSync(p, 'utf8').indexOf('TEMP-VERIFY') !== -1) hits.push(p.slice(root.length))
    }
  }
  walk(join(root, 'src')); walk(join(root, 'scripts'))
  check('nothing under src/ or scripts/ carries a TEMP-VERIFY tag', hits.length === 0, hits.join(', '))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
