#!/usr/bin/env node
// Logic harness for the site-language setting (which of he / en / ar the
// public portal and menu offer).
//
//   node scripts/check-languages.mjs
//
// Same shape as check-cart.mjs: the rules are pure functions in
// src/lib/settings/languages.ts, run here from the REAL source.
//
// WHAT IT IS ACTUALLY GUARDING
//   • Hebrew can never be switched off — everything falls back to it.
//   • A bad or missing stored value keeps languages ON (fail open), so a
//     settings hiccup can't strip a language a customer is reading in.
//   • A visitor whose saved language is switched off sees Hebrew — and the
//     helper never asks for the saved choice to be overwritten, so turning the
//     language back on restores it.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const outDir = join(tmpdir(), `ayeka-languages-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'languages.mjs'), ts.transpileModule(
  readFileSync(new URL('../src/lib/settings/languages.ts', import.meta.url), 'utf8'),
  { fileName: 'languages.ts', compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true } },
).outputText)
const L = await import(pathToFileURL(join(outDir, 'languages.mjs')).href)

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const same = (a, b) => isDeepStrictEqual(a, b)

section('defaults — no setting stored is the site as it always was')
{
  check('both English and Arabic default ON', L.SITE_LANGUAGES_DEFAULT.en === true && L.SITE_LANGUAGES_DEFAULT.ar === true)
  check('null normalizes to the default', same(L.normalizeSiteLanguages(null), { en: true, ar: true }))
  check('undefined normalizes to the default', same(L.normalizeSiteLanguages(undefined), { en: true, ar: true }))
  check('a string normalizes to the default', same(L.normalizeSiteLanguages('off'), { en: true, ar: true }))
  check('an array normalizes to the default', same(L.normalizeSiteLanguages([false, false]), { en: true, ar: true }))
  check('an empty object normalizes to the default', same(L.normalizeSiteLanguages({}), { en: true, ar: true }))
  check('the default is not shared — mutating a result cannot poison the next read', (() => {
    const a = L.normalizeSiteLanguages(null); a.en = false
    return L.normalizeSiteLanguages(null).en === true && L.SITE_LANGUAGES_DEFAULT.en === true
  })())
}

section('normalizeSiteLanguages — only an explicit false turns a language off')
{
  check('{en:false} turns off English only', same(L.normalizeSiteLanguages({ en: false, ar: true }), { en: false, ar: true }))
  check('{ar:false} turns off Arabic only', same(L.normalizeSiteLanguages({ en: true, ar: false }), { en: true, ar: false }))
  check('both false is honoured', same(L.normalizeSiteLanguages({ en: false, ar: false }), { en: false, ar: false }))
  check('"false" the string is NOT false — stays on', L.normalizeSiteLanguages({ en: 'false' }).en === true)
  check('0 is NOT false — stays on', L.normalizeSiteLanguages({ ar: 0 }).ar === true)
  check('null is NOT false — stays on', L.normalizeSiteLanguages({ en: null }).en === true)
  check('an unknown key is ignored', same(L.normalizeSiteLanguages({ en: true, ar: true, he: false, fr: false }), { en: true, ar: true }))
  check('Hebrew cannot be switched off from the stored value', L.enabledLanguages(L.normalizeSiteLanguages({ he: false })).includes('he'))
}

section('enabledLanguages — Hebrew always first, the rest in switcher order')
{
  check('all on', same(L.enabledLanguages({ en: true, ar: true }), ['he', 'en', 'ar']))
  check('English off', same(L.enabledLanguages({ en: false, ar: true }), ['he', 'ar']))
  check('Arabic off', same(L.enabledLanguages({ en: true, ar: false }), ['he', 'en']))
  check('both off leaves Hebrew alone', same(L.enabledLanguages({ en: false, ar: false }), ['he']))
  check('never empty, whatever the input', [
    { en: false, ar: false }, { en: true, ar: true }, { en: false, ar: true },
  ].every((s) => L.enabledLanguages(s).length >= 1))
}

section('resolveLanguage — what a returning visitor sees')
{
  const all = ['he', 'en', 'ar']
  check('no saved choice → Hebrew', L.resolveLanguage(null, all) === 'he')
  check('undefined → Hebrew', L.resolveLanguage(undefined, all) === 'he')
  check('empty string → Hebrew', L.resolveLanguage('', all) === 'he')
  check('a saved, offered language is kept', L.resolveLanguage('ar', all) === 'ar' && L.resolveLanguage('en', all) === 'en')
  check('Hebrew is always kept', L.resolveLanguage('he', ['he']) === 'he')
  check('a saved language that is switched off shows Hebrew', L.resolveLanguage('en', ['he', 'ar']) === 'he' && L.resolveLanguage('ar', ['he', 'en']) === 'he')
  check('with everything but Hebrew off, everyone gets Hebrew', L.resolveLanguage('ar', ['he']) === 'he' && L.resolveLanguage('en', ['he']) === 'he')
  check('a language the site never had → Hebrew', L.resolveLanguage('fr', all) === 'he')
  check('junk that merely CONTAINS a language code → Hebrew', L.resolveLanguage('en,ar', all) === 'he' && L.resolveLanguage('english', all) === 'he')
  check('with no list given, all three are offered (callers not yet taught about the setting)',
    L.resolveLanguage('ar') === 'ar' && L.resolveLanguage('en') === 'en')

  // The property the whole design leans on: switching a language off and back
  // on returns each visitor to their own choice, because resolving never
  // rewrites what was saved.
  const saved = 'ar'
  const whileOff = L.resolveLanguage(saved, ['he', 'en'])
  const afterOn = L.resolveLanguage(saved, ['he', 'en', 'ar'])
  check('off then on again: the visitor is back on their own language', whileOff === 'he' && afterOn === 'ar')
}

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
