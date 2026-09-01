#!/usr/bin/env node
// Logic harness for the customer feedback box.
//
//   node scripts/check-feedback.mjs
//
// Same shape and same reasoning as check-cart.mjs and check-shift-rules.mjs:
// the rules are pure functions with no database and no DOM, so they can be
// checked exhaustively in milliseconds. It transpiles and runs the REAL
// TypeScript sources — copying the logic in here would produce a harness that
// passes while the app is broken, which is worse than no harness.
//
// WHAT IT IS ACTUALLY GUARDING
//   • `normalizePagePath`, which is the one function in this feature where
//     being wrong puts an attacker-chosen destination inside an OP-only admin
//     page. Most of the cases below are that function.
//   • `validateFeedbackInput`, the whole gate in front of the only endpoint
//     in this app a total stranger can write to with no credential of any
//     kind.
//   • That the TypeScript caps and the CHECK constraints in migration 050
//     still say the same numbers. They are one rule spelled twice, and the
//     precedent for what happens when such a pair drifts is
//     `lib/staff/access.ts` ↔ `is_op()`.
//   • That every customer-facing string exists in all three languages.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ── transpile ──────────────────────────────────────────────────────────

const LIB = new URL('../src/lib/feedback/', import.meta.url)
const outDir = join(tmpdir(), `ayeka-feedback-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

function emit(name) {
  const source = readFileSync(new URL(name, LIB), 'utf8')
  const js = ts.transpileModule(source, {
    // ⚠️ The .ts name matters — transpileModule picks its parser from this
    // filename's extension. Hand it the .mjs OUTPUT name and it parses the
    // file as JavaScript and leaves the type annotations in place.
    fileName: name,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
  writeFileSync(join(outDir, name.replace(/\.ts$/, '.mjs')), js)
}

for (const f of ['types.ts', 'validate.ts', 'i18n.ts']) emit(f)

const load = (name) => import(pathToFileURL(join(outDir, name)).href)
const T = await load('types.mjs')
const V = await load('validate.mjs')
const I18n = await load('i18n.mjs')

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (title) => console.log(`\n${title}`)

const good = (over = {}) => ({ category: 'business', message: 'הבירה הייתה פושרת', ...over })

// ── 1. The vocabularies ────────────────────────────────────────────────
section('vocabularies — what the two enums accept')
{
  check('exactly two categories', T.FEEDBACK_CATEGORIES.length === 2)
  check('business and technical', T.FEEDBACK_CATEGORIES.join(',') === 'business,technical')
  check('exactly three statuses', T.FEEDBACK_STATUSES.join(',') === 'new,read,resolved')

  check('category guard accepts a real one', V.isFeedbackCategory('technical') === true)
  check('category guard rejects an invented one', V.isFeedbackCategory('urgent') === false)
  check('category guard rejects a non-string', V.isFeedbackCategory(1) === false)
  check('category guard rejects a prototype key', V.isFeedbackCategory('toString') === false)
  check('status guard accepts a real one', V.isFeedbackStatus('resolved') === true)
  check('status guard rejects an invented one', V.isFeedbackStatus('spam') === false)
  check('status guard rejects null', V.isFeedbackStatus(null) === false)
}

// ── 2. normalizePagePath — the security-critical one ───────────────────
section('normalizePagePath — an attacker-chosen destination must never survive')
{
  const p = V.normalizePagePath

  check('a plain path passes through', p('/menu') === '/menu')
  check('a hash is kept — it is the actionable part', p('/menu#cocktails') === '/menu#cocktails')
  check('the root path is a path', p('/') === '/')

  // The whole point of the function.
  check('an absolute https URL is refused', p('https://evil.com') === null)
  check('an absolute http URL is refused', p('http://evil.com/x') === null)
  check('a PROTOCOL-RELATIVE url is refused', p('//evil.com') === null)
  check('a protocol-relative url with a path is refused', p('//evil.com/pwn') === null)
  check('javascript: is refused', p('javascript:alert(1)') === null)
  check('data: is refused', p('data:text/html,<script>') === null)
  check('a bare word is refused', p('evil.com') === null)
  check('a relative path with no leading slash is refused', p('menu') === null)

  // Backslashes fold to slashes in browsers, so they are stripped BEFORE the
  // '//' test — otherwise `/\evil.com` sails through and then resolves
  // off-site.
  check('a backslash is stripped, leaving a same-origin path', p('/\\evil.com') === '/evil.com')
  check('a backslash that WOULD make it protocol-relative is caught', p('/\\/evil.com') === null)
  check('a leading backslash pair is caught', p('\\\\evil.com') === null)

  // The query string goes, always — see the function's own note about
  // /checkin?token=…
  check('the query string is discarded', p('/checkin?token=secret') === '/checkin')
  check('a query on the menu is discarded too', p('/menu?cat=cocktails') === '/menu')
  check('a query before a hash takes the hash with it', p('/menu?a=1#x') === '/menu')

  // Junk in, nothing out.
  check('a non-string is null', p(123) === null)
  check('null is null', p(null) === null)
  check('undefined is null', p(undefined) === null)
  check('an object is null', p({ toString: () => '/menu' }) === null)
  check('an empty string is null', p('') === null)
  check('whitespace only is null', p('   ') === null)

  // Characters that have no business in a path are dropped, not fatal.
  check('spaces are stripped', p('/me nu') === '/menu')
  check('a newline is stripped', p('/menu\nX') === '/menuX')
  check('a quote is stripped', p('/menu"onerror=x') === '/menuonerror=x')
  check('an angle bracket is stripped', p('/menu<script>') === '/menuscript')

  const long = '/' + 'a'.repeat(500)
  const cut = p(long)
  check('an over-long path is truncated, not refused', cut !== null && cut.length === T.MAX_PAGE_URL_LEN)
  check('a truncated path still starts with exactly one slash',
    cut !== null && cut.startsWith('/') && !cut.startsWith('//'))
}

// ── 3. normalizeMessage ────────────────────────────────────────────────
section('normalizeMessage — tidy, without changing what was said')
{
  const n = V.normalizeMessage
  check('leading/trailing space goes', n('  שלום  ') === 'שלום')
  check('CRLF becomes LF', n('a\r\nb') === 'a\nb')
  check('a bare CR becomes LF', n('a\rb') === 'a\nb')
  check('one blank line survives', n('a\n\nb') === 'a\n\nb')
  check('a run of blank lines collapses to one', n('a\n\n\n\n\nb') === 'a\n\nb')
  check('a NUL is stripped', n('a\u0000b') === 'ab')
  check('an escape character is stripped', n('a\u001Bb') === 'ab')
  check('DEL is stripped', n('a\u007Fb') === 'ab')
  check('a tab survives — it is not a control problem', n('a\tb') === 'a\tb')
  // Bidi marks are ordinary characters in Hebrew and Arabic text; stripping
  // them would corrupt real messages, which is why they are not in the class.
  check('an RLM survives', n('a‏ב') === 'a‏ב')
  check('an emoji survives', n('בירה 🍺') === 'בירה 🍺')
  const capped = n('x'.repeat(T.MAX_MESSAGE_LEN + 500))
  check('over-long text is capped at the maximum', capped.length === T.MAX_MESSAGE_LEN)
}

// ── 4. isPlausibleEmail ────────────────────────────────────────────────
section('isPlausibleEmail — permissive, but never header-injectable')
{
  const e = V.isPlausibleEmail
  check('an ordinary address passes', e('dana@example.com') === true)
  check('a plus tag passes', e('dana+bar@example.co.il') === true)
  check('a dotted local part passes', e('d.cohen@example.com') === true)
  check('no @ fails', e('dana.example.com') === false)
  check('no dot in the domain fails', e('dana@localhost') === false)
  check('a space fails', e('dana @example.com') === false)
  check('a newline fails — this is the header-injection case', e('dana@e.com\nBcc: x@y.z') === false)
  check('a carriage return fails', e('dana@e.com\rX') === false)
  check('a comma fails', e('dana@e.com,evil@e.com') === false)
  check('a semicolon fails', e('dana@e.com;evil@e.com') === false)
  check('an angle bracket fails', e('<dana@e.com>') === false)
  check('an over-long address fails', e('a'.repeat(250) + '@example.com') === false)
  check('an empty string fails', e('') === false)
}

// ── 5. validateFeedbackInput ───────────────────────────────────────────
section('validateFeedbackInput — the whole gate')
{
  const v = V.validateFeedbackInput

  const ok = v(good())
  check('a good submission passes', ok.ok === true)
  check('it returns the trimmed message', ok.ok && ok.value.message === 'הבירה הייתה פושרת')
  check('a missing email becomes null, not undefined', ok.ok && ok.value.contactEmail === null)
  check('a missing page becomes null', ok.ok && ok.value.pageUrl === null)

  check('a non-object is refused', v('hello').ok === false)
  check('null is refused', v(null).ok === false)
  check('an ARRAY is refused', v([]).ok === false)
  check('undefined is refused', v(undefined).ok === false)

  check('a missing category is refused', v({ message: 'hi there' }).error === 'bad_category')
  check('an invented category is refused', v(good({ category: 'legal' })).error === 'bad_category')

  check('a missing message is refused', v({ category: 'business' }).error === 'message_empty')
  check('an empty message is refused', v(good({ message: '' })).error === 'message_empty')
  check('a whitespace-only message is refused', v(good({ message: '   \n  ' })).error === 'message_empty')
  check('a one-character message is refused', v(good({ message: 'x' })).error === 'message_empty')
  check('a two-character message is accepted', v(good({ message: 'לא' })).ok === true)
  check('a non-string message is refused', v(good({ message: 42 })).error === 'message_empty')
  check('an over-long message is REFUSED, not truncated',
    v(good({ message: 'x'.repeat(T.MAX_MESSAGE_LEN + 1) })).error === 'message_too_long')
  check('a message exactly at the cap is accepted',
    v(good({ message: 'x'.repeat(T.MAX_MESSAGE_LEN) })).ok === true)
  // A message that is only control characters is empty however long it is.
  check('control characters alone are empty', v(good({ message: '\u0000\u0001\u0002' })).error === 'message_empty')

  check('a good email is kept', v(good({ contactEmail: ' dana@example.com ' })).value.contactEmail === 'dana@example.com')
  check('a blank email is not an error', v(good({ contactEmail: '   ' })).ok === true)
  check('an empty-string email is not an error', v(good({ contactEmail: '' })).ok === true)
  check('a null email is not an error', v(good({ contactEmail: null })).ok === true)
  check('a bad email IS an error', v(good({ contactEmail: 'not-an-address' })).error === 'bad_email')
  check('a non-string email is an error', v(good({ contactEmail: 7 })).error === 'bad_email')

  check('a hostile pageUrl is dropped, not fatal',
    v(good({ pageUrl: 'https://evil.com' })).value.pageUrl === null)
  check('a real pageUrl survives', v(good({ pageUrl: '/menu#beer' })).value.pageUrl === '/menu#beer')

  // The returned object is BUILT, never the caller's own with fields checked
  // — so an invented property cannot ride along into the insert.
  const smuggled = v(good({ status: 'resolved', customer_id: 'x', id: 'y', resolved_by: 'z' }))
  check('extra properties are not carried through',
    smuggled.ok && Object.keys(smuggled.value).sort().join(',') === 'category,contactEmail,message,pageUrl')
}

// ── 6. TS ↔ SQL agreement ──────────────────────────────────────────────
section('migration 050 — the caps are spelled the same in both places')
{
  const sql = readFileSync(new URL('../supabase/migrations/050_customer_feedback.sql', import.meta.url), 'utf8')

  check('message CHECK carries the same bounds as MIN/MAX_MESSAGE_LEN',
    sql.includes(`length(message) between ${T.MIN_MESSAGE_LEN} and ${T.MAX_MESSAGE_LEN}`))
  check('contact_email CHECK carries MAX_EMAIL_LEN',
    sql.includes(`length(contact_email) <= ${T.MAX_EMAIL_LEN}`))
  check('page_url CHECK carries MAX_PAGE_URL_LEN',
    sql.includes(`length(page_url) <= ${T.MAX_PAGE_URL_LEN}`))
  check('page_url CHECK refuses a protocol-relative value, as normalizePagePath does',
    sql.includes(`page_url !~ '^//'`))
  check('category CHECK lists exactly the TS categories',
    sql.includes(`check (category in (${T.FEEDBACK_CATEGORIES.map((c) => `'${c}'`).join(',')}))`))
  check('status CHECK lists exactly the TS statuses',
    sql.includes(`check (status in (${T.FEEDBACK_STATUSES.map((s) => `'${s}'`).join(',')}))`))

  // The posture claims in the migration's own header, asserted rather than
  // trusted — this is the file that would quietly become wrong.
  check('RLS is enabled on the table', /alter table public\.customer_feedback\s+enable row level security/.test(sql))
  check('no RLS policy is created', !/create policy/i.test(sql))
  check('table grants are revoked from public, anon and authenticated',
    /revoke all on public\.customer_feedback from public, anon, authenticated/.test(sql))
  check('the cleanup function revokes EXECUTE from PUBLIC explicitly',
    /revoke execute on function public\.cleanup_customer_feedback\(integer, integer\)\s*\n?\s*from public, anon, authenticated/.test(sql))
  check('customer_id survives account deletion as null, not a cascade',
    /customer_id\s+uuid references public\.customers\(id\) on delete set null/.test(sql))
  check('resolved_by cannot block an auth user from being deleted',
    /resolved_by\s+uuid references auth\.users\(id\) on delete set null/.test(sql))
}

// ── 7. Rate-limit constants ────────────────────────────────────────────
section('rate limits — present, ordered, and bounded')
{
  check('a per-IP limit exists', Number.isInteger(T.FEEDBACK_RATE_MAX) && T.FEEDBACK_RATE_MAX > 0)
  check('a global limit exists', Number.isInteger(T.FEEDBACK_GLOBAL_RATE_MAX) && T.FEEDBACK_GLOBAL_RATE_MAX > 0)
  // If the global ceiling were not comfortably above the per-IP allowance, a
  // single honest visitor could close the box for everybody.
  check('the global limit is far above one IP\'s allowance',
    T.FEEDBACK_GLOBAL_RATE_MAX >= T.FEEDBACK_RATE_MAX * 10)
  check('both windows are the same length, so they can be reasoned about together',
    T.FEEDBACK_RATE_WINDOW_SECONDS === T.FEEDBACK_GLOBAL_RATE_WINDOW_SECONDS)
}

// ── 8. i18n completeness ───────────────────────────────────────────────
section('i18n — every string exists in all three languages')
{
  const missing = []
  for (const [key, value] of Object.entries(I18n.FEEDBACK_UI)) {
    for (const lang of ['he', 'en', 'ar']) {
      if (typeof value[lang] !== 'string' || !value[lang].trim()) missing.push(`${key}.${lang}`)
    }
  }
  check(`all ${Object.keys(I18n.FEEDBACK_UI).length} strings are trilingual`,
    missing.length === 0, missing.join(', '))

  // Every reason the validator can return must reach the customer as a
  // sentence in their own language — an unmapped code would render as the
  // generic fallback, which is a silent downgrade rather than a visible bug.
  for (const code of ['bad_request', 'bad_category', 'message_empty', 'message_too_long', 'bad_email', 'rate_limited', 'disabled']) {
    for (const lang of ['he', 'en', 'ar']) {
      const text = I18n.feedbackErrorText(code, lang)
      check(`${code} → ${lang} has a message`, typeof text === 'string' && text.length > 0)
    }
  }
  check('an unknown code falls back rather than rendering blank',
    I18n.feedbackErrorText('who_knows', 'he') === I18n.FEEDBACK_UI.errGeneric.he)
  check('an undefined code falls back too',
    I18n.feedbackErrorText(undefined, 'ar') === I18n.FEEDBACK_UI.errGeneric.ar)
  // These two are distinct messages on purpose — "too many" and "closed" are
  // different situations and lead to different actions.
  check('rate_limited and disabled do not say the same thing',
    I18n.feedbackErrorText('rate_limited', 'he') !== I18n.feedbackErrorText('disabled', 'he'))
}

// ── report ─────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
