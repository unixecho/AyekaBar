#!/usr/bin/env node
// Logic + wiring harness for the staff ONBOARDING WIZARD and its JOIN LINKS (2026-10-14; migration 059).
//
//   node scripts/check-join.mjs
//
// The rules are pure (lib/staff/join.ts), so this runs the REAL TypeScript. It also reads the routes, the page and the
// wizard as text and holds them to what their headers promise — the claims that matter most are structural ("WHO is
// linked comes from the session, never the body", "the page never writes", "the link is never stored on the device").
//
// WHAT IT GUARDS
//   • every refusal the SQL can give has a sentence in Hebrew and a 4xx — checked AGAINST the SQL text, so adding a
//     reason to migration 059 without teaching the app fails here (the "one rule spelled twice" lesson);
//   • the token's shape, the wizard's screen logic, the link state shown to the owner, the share message;
//   • that a join link is not a new thing to disclose: nothing stored on the device, no new host except staff-only wa.me;
//   • that the sign-in hand-off is the house interstitial and follows the same-origin `next` rule.
//
// What the database does with a link is proved by check-migration-059-060.mjs.

import ts from 'typescript'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (p) => readFileSync(join(ROOT, p), 'utf8')
const outDir = join(tmpdir(), `ayeka-join-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
const transpile = (src, name) => ts.transpileModule(src, {
  fileName: name, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
}).outputText
writeFileSync(join(outDir, 'join.mjs'), transpile(read('src/lib/staff/join.ts'), 'join.ts'))
const J = await import(pathToFileURL(join(outDir, 'join.mjs')).href)

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1')
const code = (p) => strip(read(p))
const HEBREW = /[֐-׿]/

// ───────────────────────────────────────────────────────────────────────────
section('the token')
{
  let allOk = true
  for (let i = 0; i < 300; i++) if (!J.isJoinToken(randomBytes(J.JOIN_TOKEN_BYTES).toString('base64url'))) allOk = false
  check('32 random bytes as base64url is always a valid token (300 samples, always 43 characters)', allOk)
  const good = randomBytes(32).toString('base64url')
  check('42 and 44 characters are refused', !J.isJoinToken(good.slice(1)) && !J.isJoinToken(good + 'a'))
  check('standard-base64 characters (+ / =) are refused — a token is URL-safe', !J.isJoinToken('+'.repeat(43)) && !J.isJoinToken('/'.repeat(43)) && !J.isJoinToken('='.repeat(43)))
  check('whitespace, path parts and quotes are refused', !J.isJoinToken(' ' + good.slice(1)) && !J.isJoinToken('../'.repeat(15) + 'a') && !J.isJoinToken(`"${good.slice(1)}`))
  check('non-strings are refused', !J.isJoinToken(null) && !J.isJoinToken(undefined) && !J.isJoinToken(12345) && !J.isJoinToken({}))
  check('the wizard path is /join/<token>', J.joinPath(good) === `/join/${good}`)
  const server = code('src/lib/staff/join-server.ts')
  check('tokens are minted with node:crypto randomBytes(32) → base64url, and stored as sha256 hex',
    /randomBytes\(JOIN_TOKEN_BYTES\)\.toString\('base64url'\)/.test(server) && /createHash\('sha256'\)\.update\(token\)\.digest\('hex'\)/.test(server) && J.JOIN_TOKEN_BYTES === 32)
  check('a token is never logged', !/console\.(log|error|warn)\([^)]*\btoken\b/.test(server))
}

section('lifetime ↔ the SQL')
{
  const sql = read('supabase/migrations/059_staff_join_links.sql')
  check('the default lifetime is the SQL default', new RegExp(`p_ttl_hours integer default ${J.JOIN_TTL_HOURS_DEFAULT}\\b`).test(sql) && J.JOIN_TTL_HOURS_DEFAULT === 168)
  check('the ceiling is the SQL ceiling (30 days)', new RegExp(`least\\(greatest\\(coalesce\\(p_ttl_hours, ${J.JOIN_TTL_HOURS_DEFAULT}\\), 1\\), ${J.JOIN_TTL_HOURS_MAX}\\)`).test(sql) && J.JOIN_TTL_HOURS_MAX === 720)
  check('the join link’s own limits are generous for an owner and tight for a stranger',
    J.JOIN_LIMITS.issue.max >= 10 && J.JOIN_LIMITS.claim.max <= 20 && J.JOIN_LIMITS.peek.windowSeconds >= 60)
}

// ───────────────────────────────────────────────────────────────────────────
section('every status and every refusal — the SQL and the app agree')
{
  const sql = read('supabase/migrations/059_staff_join_links.sql')
  const fnBody = (name) => {
    const start = sql.indexOf(`function public.${name}`)
    const next = sql.indexOf('create or replace function', start + 10)
    return sql.slice(start, next === -1 ? undefined : next)
  }
  const reasonsIn = (body) => Array.from(new Set(Array.from(body.matchAll(/'reason', '([a-z_]+)'/g)).map((m) => m[1]))).sort()
  const statusesIn = (body) => Array.from(new Set(Array.from(body.matchAll(/'status', '([a-z_]+)'/g)).map((m) => m[1]))).sort()

  const claimReasons = reasonsIn(fnBody('staff_join_claim'))
  check('the SQL gives 11 distinct refusals on claim', claimReasons.length === 11, claimReasons.join())
  const messageKeys = Object.keys(J.JOIN_MESSAGES)
  check('EVERY claim refusal in the SQL has a Hebrew message', claimReasons.every((r) => messageKeys.includes(r)), `missing: ${claimReasons.filter((r) => !messageKeys.includes(r)).join()}`)
  check('EVERY claim refusal in the SQL has an HTTP status in the app', claimReasons.every((r) => r in J.CLAIM_STATUS), `missing: ${claimReasons.filter((r) => !(r in J.CLAIM_STATUS)).join()}`)
  check('…and the app invents none the SQL cannot give', Object.keys(J.CLAIM_STATUS).every((r) => claimReasons.includes(r)), `extra: ${Object.keys(J.CLAIM_STATUS).filter((r) => !claimReasons.includes(r)).join()}`)
  check('every refusal is a 4xx — never a 5xx for something the person can fix', Object.values(J.CLAIM_STATUS).every((s) => s >= 400 && s < 500))

  const peekStatuses = statusesIn(fnBody('staff_join_peek'))
  check('every status peek can return is a status the app understands', peekStatuses.every((s) => messageKeys.includes(s)), peekStatuses.join())
  check('…and the app’s status vocabulary equals the SQL’s', JSON.stringify(peekStatuses) === JSON.stringify(['expired', 'inactive', 'linked', 'ok', 'revoked', 'unknown', 'used']), peekStatuses.join())

  const issueReasons = reasonsIn(fnBody('staff_join_issue'))
  const server = read('src/lib/staff/join-server.ts')
  const tsIssue = (server.match(/const ISSUE_REASONS[^=]*=\s*\[([^\]]+)\]/)?.[1] ?? '').match(/'([a-z_]+)'/g)?.map((s) => s.replace(/'/g, '')).sort() ?? []
  check('the issue refusals in TypeScript equal the SQL’s', JSON.stringify(tsIssue) === JSON.stringify(issueReasons), `${tsIssue.join()} vs ${issueReasons.join()}`)
  const route = read('src/app/api/owner/staff/join/route.ts')
  check('…and the owner route has a sentence and a status for each', issueReasons.every((r) => new RegExp(`\\b${r}:`).test(route.slice(route.indexOf('MESSAGES'))) ), issueReasons.join())

  check('every message is Hebrew and says something', Object.entries(J.JOIN_MESSAGES).every(([k, m]) => k === 'ok' || (HEBREW.test(m.title) && m.title.length > 6 && HEBREW.test(m.body) && m.body.length > 8)))
  check('no message leaks a code or a stack', Object.values(J.JOIN_MESSAGES).every((m) => !/[a-z_]{4,}\(|undefined|null|Error/.test(m.title + m.body)))
  check('messageFor falls back to the calm "not found" for anything unknown', J.messageFor('nope').title === J.JOIN_MESSAGES.unknown.title)
}

section('parsing what the database returns')
{
  const p = J.parsePeek({ status: 'ok', first_name: '  דנה ', badge: 'waiter', expires_at: '2026-10-21T00:00:00Z', email: 'secret@x.com', id: 'zzz' })
  check('a good peek keeps only name, badge and expiry', p.status === 'ok' && p.firstName === 'דנה' && p.badge === 'waiter' && p.expiresAt === '2026-10-21T00:00:00Z' && !('email' in p) && !('id' in p))
  check('a non-ok status drops every personal field, whatever was sent', (() => { const x = J.parsePeek({ status: 'expired', first_name: 'דנה', badge: 'waiter' }); return x.status === 'expired' && x.firstName === null && x.badge === null })())
  check('garbage in → "unknown" out', ['x', 12, null, undefined, [], { status: 'pwned' }, { status: 5 }].every((g) => J.parsePeek(g).status === 'unknown'))
  check('an enormous name is cut to 80 characters', J.parsePeek({ status: 'ok', first_name: 'א'.repeat(500) }).firstName.length === 80)
  check('an empty or whitespace name is null', J.parsePeek({ status: 'ok', first_name: '   ' }).firstName === null)
  check('a good claim', (() => { const c = J.parseClaim({ ok: true, already: true }); return c.ok && c.already && c.reason === null })())
  check('a refused claim carries a known reason', J.parseClaim({ ok: false, reason: 'email_in_use' }).reason === 'email_in_use')
  check('an unknown reason becomes "unknown"; garbage is never ok', J.parseClaim({ ok: false, reason: 'drop table' }).reason === 'unknown' && ['x', null, 1, [], { ok: 'true' }, { ok: 1 }].every((g) => J.parseClaim(g).ok === false))
}

section('the wizard’s screens')
{
  const S = (o) => J.wizardStep({ status: 'ok', signedIn: false, claimed: false, introSeen: false, ...o })
  check('a good link, nobody signed in → welcome', S({}) === 'welcome')
  check('…after the welcome → connect', S({ introSeen: true }) === 'connect')
  check('signed in (back from Google) → confirm, whatever the intro state', S({ signedIn: true }) === 'confirm' && S({ signedIn: true, introSeen: true }) === 'confirm')
  check('claimed → done, even if the link has just been spent (status would now read "used")', S({ claimed: true, status: 'used', signedIn: true }) === 'done')
  for (const status of ['unknown', 'expired', 'used', 'revoked', 'inactive', 'linked']) {
    check(`a ${status} link → a dead end, signed in or not`, S({ status }) === 'dead' && S({ status, signedIn: true }) === 'dead')
  }
  check('the progress dots: 3 steps, confirm shares step 2', J.WIZARD_STEPS.length === 3 && J.progressIndex('welcome') === 0 && J.progressIndex('connect') === 1 && J.progressIndex('confirm') === 1 && J.progressIndex('done') === 2)
}

section('what the owner sees next to a person who has not joined')
{
  const now = new Date('2026-10-14T12:00:00Z')
  const day = 86_400_000
  const L = (over = {}) => ({ expires_at: new Date(+now + 3 * day).toISOString(), used_at: null, revoked_at: null, ...over })
  check('no link → none', J.joinLinkState(null, now) === 'none' && J.joinLinkState(undefined, now) === 'none')
  check('a live link → live', J.joinLinkState(L(), now) === 'live')
  check('past its expiry → expired', J.joinLinkState(L({ expires_at: new Date(+now - 1000).toISOString() }), now) === 'expired')
  check('used → used (even if also past expiry)', J.joinLinkState(L({ used_at: now.toISOString(), expires_at: new Date(+now - day).toISOString() }), now) === 'used')
  check('revoked → none (a cancelled link is as good as no link)', J.joinLinkState(L({ revoked_at: now.toISOString() }), now) === 'none')
  check('the exact expiry instant counts as expired', J.joinLinkState(L({ expires_at: now.toISOString() }), now) === 'expired')
  check('expiryLabel is Hebrew and survives garbage', HEBREW.test(J.expiryLabel('2026-10-21T10:00:00Z')) && J.expiryLabel('nope') === '')
}

section('the message the owner sends')
{
  const url = 'https://ayeka.bar/join/abcDEF_-123'
  const t = J.shareText('דנה', url)
  check('it greets by first name, is Hebrew, and ends with the link on its own line', t.startsWith('היי דנה,') && HEBREW.test(t) && t.endsWith(`\n${url}`))
  check('without a name it still reads naturally', J.shareText(null, url).startsWith('היי,'))
  const l = J.shareLinks(t)
  check('WhatsApp / SMS / mail links carry the whole text, encoded', decodeURIComponent(l.whatsapp.split('?text=')[1]) === t && decodeURIComponent(l.sms.split('body=')[1]) === t && decodeURIComponent(l.mailto.split('&body=')[1]) === t)
  check('…and can’t be bent into another URL by the text (newlines and & are encoded)', !/[\n ]/.test(l.whatsapp) && !l.whatsapp.slice(l.whatsapp.indexOf('?text=') + 6).includes('&'))
  check('WhatsApp is the one new host, and it is declared staff-only', /'wa\.me'/.test(read('src/lib/privacy/registry.ts').split('STAFF_ONLY_LINK_OUT_HOSTS')[1] ?? ''))
}

// ───────────────────────────────────────────────────────────────────────────
section('wiring (read as text)')
{
  const claim = code('src/app/api/join/claim/route.ts')
  check('claim: WHO is linked comes from the SESSION — the body can only name the token', /createClient\(\)\.auth\.getUser\(\)/.test(claim) && /body\?\.token/.test(claim) && !/body[?!]*\.(userId|user_id|user|id|staffId)\b/.test(claim))
  check('claim: signed-out → 401 before anything else is read', claim.indexOf('getUser()') < claim.indexOf('request.json()'))
  check('claim: the token’s shape is checked before the database is asked', claim.indexOf('isJoinToken(') > -1 && claim.indexOf('isJoinToken(') < claim.indexOf('claimJoin('))
  check('claim: same-origin only', /headers\.get\('origin'\)/.test(claim) && /headers\.get\('host'\)/.test(claim))
  check('claim: rate limited per person AND per IP', /join-claim:\$\{user\.id\}/.test(claim) && /join-claim:ip:/.test(claim))
  check('claim: goes through claimJoin with the SERVICE client (the function is service-role only)', /claimJoin\(createServiceClient\(\)/.test(claim))
  check('claim: never cached', /no-store/.test(claim))

  const owner = code('src/app/api/owner/staff/join/route.ts')
  check('issue: OWNER only (requireOwner) on both verbs', (owner.match(/requireOwner\(\)/g) ?? []).length === 2)
  check('issue: same-origin only on both verbs', (owner.match(/foreignOrigin\(request\)/g) ?? []).length === 2)
  check('issue: the response carries the URL and NEVER the hash', /url,\s*expiresAt/.test(owner) && !/hash\s*[,}]/.test(owner.slice(owner.indexOf('NextResponse.json({ ok: true, url'))))
  check('issue: the link is built on the host the owner is on', /request\.nextUrl\.origin/.test(owner))
  check('issue: never cached (it carries a secret)', /no-store/.test(owner))
  check('issue: rate limited', /checkRateLimit\(`join-issue:/.test(owner))

  const page = code('src/app/join/[token]/page.tsx')
  const pageRaw = read('src/app/join/[token]/page.tsx')
  check('page: no referrer (the token is in the URL and the next click leaves for Google)', /referrer:\s*'no-referrer'/.test(pageRaw))
  check('page: noindex and never cached', /index:\s*false/.test(pageRaw) && /dynamic\s*=\s*'force-dynamic'/.test(pageRaw))
  check('page: READ-ONLY — it can peek but never claim', /peekJoin\(/.test(page) && !/claimJoin|staff_join_claim|\.update\(|\.insert\(/.test(page))
  check('page: the lookup is rate limited per IP', /join-peek:ip:/.test(page))
  check('page: a malformed token never reaches the database', page.indexOf('isJoinToken(') > -1 && page.indexOf('isJoinToken(') < page.indexOf('peekJoin('))
  check('page: is public — not behind sign-in and not in any protected prefix', !/'\/join/.test(read('src/middleware.ts')) && !/\/join/.test(read('src/lib/staff/access.ts')))

  const wiz = code('src/components/staff/JoinWizard.tsx')
  check('wizard: the Google hand-off is the HOUSE two-step interstitial, in its staff wording', /<AuthHandoff[\s\S]*variant="staff"/.test(wiz))
  check('wizard: Google returns to THIS page via the same-origin `next` (never an absolute URL)', /\/auth\/callback\?next=\$\{encodeURIComponent\(joinPath\(p\.token\)\)\}/.test(wiz))
  check('wizard: forces the account chooser (the whole point is picking the right account)', /prompt:\s*'select_account'/.test(wiz))
  check('wizard: confirming sends the token and nothing else', /JSON\.stringify\(\{ token: p\.token \}\)/.test(wiz))
  check('wizard: the account that came back is shown BEFORE anything is linked', wiz.indexOf('AccountBox') > -1 && wiz.indexOf('זה החשבון הנכון') < wiz.indexOf('אישור וחיבור'))
  check('wizard: there is a way to swap the account', /זה לא החשבון שלי/.test(wiz) && /api\/auth\/signout/.test(wiz))
  check('wizard: every screen moves focus to its heading and the progress is announced', /headingRef\.current\?\.focus/.test(wiz) && /aria-current/.test(wiz))
  check('wizard: stores NOTHING on the device', !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(wiz + code('src/components/staff/JoinLinkSheet.tsx')))
  check('wizard: the last step offers the push card the scheduler already built (its "wizard" variant)', /StaffPushCard variant="wizard"/.test(wiz))
  check('wizard: the dead end is a sentence plus a way out, never a blank', /<Dead/.test(wiz) && /לדף הכניסה/.test(wiz))

  const callback = read('src/app/auth/callback/route.ts')
  const fn = callback.match(/function safeNext[\s\S]*$/)?.[0]   // it is the last function in the file
  check('the auth callback has safeNext', !!fn)
  const safeNext = new Function(`${ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText}; return safeNext`)()
  const tokenPath = J.joinPath(randomBytes(32).toString('base64url'))
  check('…and it lets a /join/<token> path through (so Google can bring the person back)', safeNext(tokenPath) === tokenPath)
  check('…while still refusing the open-redirect shapes', safeNext('//evil.com') === null && safeNext('https://evil.com') === null && safeNext('/\\evil') !== '//evil' && safeNext('javascript:alert(1)') === null)

  const mgr = code('src/components/StaffManager.tsx')
  check('roster: the join button is only for people with NO login who are not owners',
    /!m\.auth_user_id && m\.role !== 'owner' && m\.badge !== 'owner'/.test(mgr))
  check('roster: generating over a live link asks first (it retires the old one)', /joinLinkState\(joinLinks\[m\.id\]\) !== 'live'/.test(mgr) && /confirmJoinNew/.test(mgr))
  check('roster: the URL lives only in the open sheet — never in the roster state', !/joinLinks\[[^\]]+\]\s*=\s*\{[^}]*url/.test(mgr) && /setShownLink\(/.test(mgr))
  check('roster: removing a person revokes their live link', /revokeJoin\(auth\.service, id\)/.test(code('src/app/api/owner/staff/route.ts')))
  check('roster: the GET returns link STATE (dates), never a hash or a URL', /latestJoinLinks/.test(code('src/app/api/owner/staff/route.ts')) && !/token_hash/.test(code('src/app/api/owner/staff/route.ts')) && /select\('staff_id, expires_at, used_at, revoked_at, created_at'\)/.test(code('src/lib/staff/join-server.ts')))

  const ah = read('src/components/AuthHandoff.tsx')
  check('AuthHandoff: the staff variant changes ONLY the third row (the customer wording is untouched)',
    /variant\?: 'customer' \| 'staff'/.test(ah) && /COPY\.he\.rows\[0\],\s*COPY\.he\.rows\[1\]/.test(ah) && /variant === 'staff' \? \{ \.\.\.base, rows: STAFF_ROWS\[lang\] \} : base/.test(ah))
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) { console.log('\nFailures:\n  - ' + failures.join('\n  - ')); process.exit(1) }
