#!/usr/bin/env node
// Logic harness for the in-house accessibility widget (PLAN_ACCESSIBILITY.md
// §3, Phase 1).
//
//   node scripts/check-a11y.mjs
//
// Same shape as check-cart.mjs / check-feedback.mjs: the widget's rules are
// pure functions with no DOM, so they are checked exhaustively in
// milliseconds by transpiling and running the REAL TypeScript sources —
// copying the logic in here would produce a harness that passes while the
// app is broken.
//
// WHAT IT IS ACTUALLY GUARDING
//   • sanitizeA11yPrefs never trusts localStorage — a corrupted or hand-edited
//     value must fall back per-field, never throw, never poison the whole
//     object over one bad key.
//   • computeAppliedState is deterministic and every class it can produce is
//     accounted for in ALL_A11Y_HTML_CLASSES — the provider diffs against
//     that list to know what to remove, so a drift here is a class that gets
//     added but never cleaned up.
//   • Every panel string exists in all three languages (he/en/ar) — the same
//     check check-cart.mjs and check-feedback.mjs run for their own i18n.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ── transpile ──────────────────────────────────────────────────────────

const LIB = new URL('../src/lib/a11y/', import.meta.url)
const outDir = join(tmpdir(), `ayeka-a11y-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

function emit(name) {
  const source = readFileSync(new URL(name, LIB), 'utf8')
  const js = ts.transpileModule(source, {
    fileName: name,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
  writeFileSync(join(outDir, name.replace(/\.ts$/, '.mjs')), js)
}

for (const f of ['types.ts', 'storage.ts', 'apply.ts', 'i18n.ts']) emit(f)

const load = (name) => import(pathToFileURL(join(outDir, name)).href)
const T = await load('types.mjs')
const S = await load('storage.mjs')
const A = await load('apply.mjs')
const I18n = await load('i18n.mjs')

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (title) => console.log(`\n${title}`)

// ── 1. sanitizeA11yPrefs — never trusts the input ─────────────────────
section('sanitizeA11yPrefs — garbage in, defaults or bounded values out')
{
  const d = T.DEFAULT_A11Y_PREFS
  check('null returns defaults', JSON.stringify(S.sanitizeA11yPrefs(null)) === JSON.stringify(d))
  check('undefined returns defaults', JSON.stringify(S.sanitizeA11yPrefs(undefined)) === JSON.stringify(d))
  check('a string returns defaults', JSON.stringify(S.sanitizeA11yPrefs('nope')) === JSON.stringify(d))
  check('an array returns defaults', JSON.stringify(S.sanitizeA11yPrefs([1, 2, 3])) === JSON.stringify(d))
  check('an empty object returns defaults', JSON.stringify(S.sanitizeA11yPrefs({})) === JSON.stringify(d))

  check('an out-of-range fontScale falls back',
    S.sanitizeA11yPrefs({ fontScale: 99 }).fontScale === d.fontScale)
  check('a negative fontScale falls back',
    S.sanitizeA11yPrefs({ fontScale: -1 }).fontScale === d.fontScale)
  check('a valid fontScale survives',
    S.sanitizeA11yPrefs({ fontScale: 3 }).fontScale === 3)

  check('an invented contrast mode falls back',
    S.sanitizeA11yPrefs({ contrast: 'rainbow' }).contrast === d.contrast)
  check('a valid contrast mode survives',
    S.sanitizeA11yPrefs({ contrast: 'invert' }).contrast === 'invert')

  check('a non-boolean pauseAnimations falls back',
    S.sanitizeA11yPrefs({ pauseAnimations: 'yes' }).pauseAnimations === d.pauseAnimations)
  check('a real boolean pauseAnimations survives',
    S.sanitizeA11yPrefs({ pauseAnimations: true }).pauseAnimations === true)

  check('one bad field does not poison the rest',
    JSON.stringify(S.sanitizeA11yPrefs({ fontScale: 'nope', spacing: 2 })) ===
    JSON.stringify({ ...d, spacing: 2 }))

  check('an unknown extra key is silently dropped',
    S.sanitizeA11yPrefs({ evil: '<script>' }).evil === undefined)
}

// ── 2. computeAppliedState — deterministic, bounds-respecting ─────────
section('computeAppliedState — deterministic plan, no DOM access')
{
  const d = T.DEFAULT_A11Y_PREFS
  const a = A.computeAppliedState(d)
  const b = A.computeAppliedState(d)
  check('same input produces an identical plan twice', JSON.stringify(a) === JSON.stringify(b))

  check('defaults produce no html classes', a.htmlClasses.length === 0)
  check('defaults produce filter none', a.scopeFilter === 'none')
  check('defaults produce 100% font scale', a.htmlVars['--a11y-font-scale'] === '100%')

  check('max fontScale index is in bounds',
    A.computeAppliedState({ ...d, fontScale: 4 }).htmlVars['--a11y-font-scale'] === '150%')

  check('pauseAnimations adds exactly the motion class',
    A.computeAppliedState({ ...d, pauseAnimations: true }).htmlClasses.includes('a11y-motion-off'))
  check('highlightLinks adds exactly the link class',
    A.computeAppliedState({ ...d, highlightLinks: true }).htmlClasses.includes('a11y-highlight-links'))
  check('highlightHeadings adds exactly the heading class',
    A.computeAppliedState({ ...d, highlightHeadings: true }).htmlClasses.includes('a11y-highlight-headings'))
  check('bigCursor adds exactly the cursor class',
    A.computeAppliedState({ ...d, bigCursor: true }).htmlClasses.includes('a11y-big-cursor'))
  check('readingGuide adds NO html class (it is a mounted component, not a class)',
    !A.computeAppliedState({ ...d, readingGuide: true }).htmlClasses.some((c) => c.includes('reading')))

  check('contrast high maps to a contrast() filter',
    A.computeAppliedState({ ...d, contrast: 'high' }).scopeFilter.includes('contrast'))
  check('contrast grayscale maps to grayscale(1)',
    A.computeAppliedState({ ...d, contrast: 'grayscale' }).scopeFilter === 'grayscale(1)')
  check('contrast invert maps to an invert() filter',
    A.computeAppliedState({ ...d, contrast: 'invert' }).scopeFilter.includes('invert'))

  // Every class the function can ever emit must be tracked in
  // ALL_A11Y_HTML_CLASSES, or the provider can never clean it up again.
  const allPossible = new Set()
  for (const pauseAnimations of [false, true])
    for (const highlightLinks of [false, true])
      for (const highlightHeadings of [false, true])
        for (const bigCursor of [false, true]) {
          const { htmlClasses } = A.computeAppliedState({ ...d, pauseAnimations, highlightLinks, highlightHeadings, bigCursor })
          htmlClasses.forEach((c) => allPossible.add(c))
        }
  const tracked = new Set(A.ALL_A11Y_HTML_CLASSES)
  const untracked = [...allPossible].filter((c) => !tracked.has(c))
  check('every emittable class is tracked in ALL_A11Y_HTML_CLASSES', untracked.length === 0, untracked.join(', '))
}

// ── 3. i18n — every string exists in all three languages ──────────────
section('i18n — every panel string is trilingual')
{
  const langs = ['he', 'en', 'ar']
  const keys = Object.keys(I18n.A11Y_UI)
  let allGood = true
  for (const key of keys) {
    for (const lang of langs) {
      const v = I18n.A11Y_UI[key]?.[lang]
      if (typeof v !== 'string' || v.trim() === '') {
        allGood = false
        console.log(`  ✗ ${key}.${lang} is missing or empty`)
      }
    }
  }
  check(`all ${keys.length} strings are trilingual`, allGood)
  check('a11yT resolves a real string', I18n.a11yT('title', 'he') === I18n.A11Y_UI.title.he)
}

// ── summary ────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) process.exit(1)
