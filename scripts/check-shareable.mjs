#!/usr/bin/env node --experimental-strip-types
// Logic harness for src/lib/waiter/shareable.ts (requirement §12).
//
// This project has no test runner and deliberately keeps dependencies minimal,
// so rules get a plain harness — the same pattern as the happy-hour / schedule
// / access-level suites (HANDOFF.md 2026-08-07, "113 logic checks").
//
//   node --experimental-strip-types scripts/check-shareable.mjs
//
// Every fixture below is a REAL item from the live menu — uid, price and
// category all copied from public.public_menus — so a passing run says the
// rules hold for the actual bar, not for invented data.

import {
  deriveVariants, isJug, canShare, allowedQuantities,
  isQuantityAllowed, validateLine,
} from '../src/lib/waiter/shareable.ts'

let pass = 0
const failures = []

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else failures.push(`${name}\n      expected ${e}\n      actual   ${a}`)
}

/* ── Real menu fixtures ───────────────────────────────────────────── */

const M = {
  hashBrowns:  { cat: 'starters',       uid: 'wtyoqt7nlg', price: 44,      he: 'האש בראונס' },
  houseBread:  { cat: 'oven',           uid: 'hbgmzqpu21', price: 36,      he: 'לחם הבית' },
  toastAviv:   { cat: 'oven',           uid: '42fjz58u41', price: 49,      he: 'טוסט(א)ביב' },
  cocktailDual:{ cat: 'cocktails',      uid: 'oc05f34ueh', price: '52/208',he: 'רווקה לדקה' },
  cocktailOne: { cat: 'cocktails',      uid: 'ceuzjd3j19', price: 54,      he: 'ויקום המלפפון' },
  breezer:     { cat: 'cocktails',      uid: 'jvdd4rej1v', price: 28,      he: 'בריזר' },
  limonana:    { cat: 'combos',         uid: 'tna8244qw0', price: '28/48', he: 'לימונענע' },
  chaserArak:  { cat: 'chasers',        uid: 'dwp7lxyygs', price: 18,      he: 'ערק' },
  chaserBeluga:{ cat: 'premiumChasers', uid: '8jaj1bnrgu', price: 22,      he: 'בלוגה' },
  pizza:       { cat: 'pizzas',         uid: 'ppz0000000', price: 62,      he: 'פיצה' },
  combo:       { cat: 'celebration',    uid: '2r1wwxu41p', price: 750,     he: 'קומבינציה בלוגה' },
  nachos:      { cat: 'barSnacks',      uid: '62xnu9c51o', price: 28,      he: 'נאצ׳וס' },
  hookah:      { cat: 'hookah',         uid: '59q669k07p', price: 45,      he: 'ראש נרגילה' },
  snooker:     { cat: 'snooker',        uid: 't3cv1j8d9a', price: 35,      he: 'הזמנת משחק' },
  cola:        { cat: 'softDrinks',     uid: 'lpclbyhmyo', price: 14,      he: 'קוקה קולה' },
  whiskey:     { cat: 'whiskey',        uid: 'wsk0000000', price: 40,      he: 'וויסקי' },
  draft:       { cat: 'draftBeer',      uid: 'drf0000000', price: '30/34', he: 'בירה מהחבית' },
  wine:        { cat: 'wines',          uid: 'wne0000000', price: '49/139',he: 'יין' },
}

const vars = (f) => deriveVariants({ price: f.price, uid: f.uid }, f.cat)
const ctx = (f, { v = 0, qty = 1 } = {}) => ({
  categoryId: f.cat,
  itemUid: f.uid,
  variant: vars(f)[v] ?? null,
  qty,
})

/* ── 1. Variant derivation ────────────────────────────────────────── */

check('single price → one variant', vars(M.hashBrowns).length, 1)
check('dual price → two variants', vars(M.cocktailDual).length, 2)
check('dual price splits correctly',
  vars(M.cocktailDual).map((v) => v.price), [52, 208])
check('cocktail second variant is קנקן',
  vars(M.cocktailDual)[1].label.he, 'קנקן')
check('combos second variant is קנקן',
  vars(M.limonana)[1].label.he, 'קנקן')
check('combos splits 28/48', vars(M.limonana).map((v) => v.price), [28, 48])
check('draft beer second variant is a size, not a jug',
  vars(M.draft)[1].label.he, 'חצי')
check('wine second variant is a bottle, not a jug',
  vars(M.wine)[1].label.he, 'בקבוק')
check('no price → no variants', deriveVariants({ price: null }, 'starters'), [])

check('isJug true for cocktail pitcher',  isJug(vars(M.cocktailDual)[1]), true)
check('isJug false for cocktail single',  isJug(vars(M.cocktailDual)[0]), false)
check('isJug true for combos pitcher',    isJug(vars(M.limonana)[1]), true)
check('isJug false for half-litre beer',  isJug(vars(M.draft)[1]), false)
check('isJug false for wine bottle',      isJug(vars(M.wine)[1]), false)

/* ── 2. Whole-category shareables ─────────────────────────────────── */

check('ראשונות shareable',        canShare(ctx(M.hashBrowns)), true)
check('פיצות shareable',          canShare(ctx(M.pizza)), true)
check('חגיגה על השולחן shareable',canShare(ctx(M.combo)), true)
check('ליד הבירה shareable',      canShare(ctx(M.nachos)), true)
check('נרגילה shareable',         canShare(ctx(M.hookah)), true)
check('סנוקר shareable',          canShare(ctx(M.snooker)), true)

/* ── 3. Not shareable ─────────────────────────────────────────────── */

check('soft drink not shareable',  canShare(ctx(M.cola)), false)
check('whiskey not shareable',     canShare(ctx(M.whiskey)), false)
check('half-litre beer not shareable', canShare(ctx(M.draft, { v: 1 })), false)
check('wine bottle not shareable', canShare(ctx(M.wine, { v: 1 })), false)

/* ── 4. לחם הבית — item-level, not category-level ─────────────────── */

check('לחם הבית shareable',            canShare(ctx(M.houseBread)), true)
check('טוסט beside it NOT shareable',  canShare(ctx(M.toastAviv)), false)

/* ── 5. Cocktails: jug only ───────────────────────────────────────── */

check('single cocktail NOT shareable',  canShare(ctx(M.cocktailDual, { v: 0 })), false)
check('cocktail קנקן shareable',        canShare(ctx(M.cocktailDual, { v: 1 })), true)
check('cocktail with no jug price NOT shareable', canShare(ctx(M.cocktailOne)), false)
check('בריזר (no jug) NOT shareable',   canShare(ctx(M.breezer)), false)

/* ── 6. קנקן לימונענע — falls out of the jug rule, no special case ── */

check('לימונענע כוס NOT shareable', canShare(ctx(M.limonana, { v: 0 })), false)
check('קנקן לימונענע shareable',    canShare(ctx(M.limonana, { v: 1 })), true)

/* ── 7. Chasers: quantity 1 or 4, shareable only at 4 ─────────────── */

check('chaser quantities are 1 and 4', allowedQuantities('chasers'), [1, 4])
check('premium chaser quantities too', allowedQuantities('premiumChasers'), [1, 4])
check('other categories unrestricted', allowedQuantities('starters'), null)

check('chaser qty 1 allowed', isQuantityAllowed('chasers', 1), true)
check('chaser qty 4 allowed', isQuantityAllowed('chasers', 4), true)
check('chaser qty 2 rejected', isQuantityAllowed('chasers', 2), false)
check('chaser qty 3 rejected', isQuantityAllowed('chasers', 3), false)
check('chaser qty 5 rejected', isQuantityAllowed('chasers', 5), false)
check('chaser qty 0 rejected', isQuantityAllowed('chasers', 0), false)
check('starters qty 3 fine',   isQuantityAllowed('starters', 3), true)
check('fractional qty rejected', isQuantityAllowed('starters', 1.5), false)

check('single chaser NOT shareable', canShare(ctx(M.chaserArak, { qty: 1 })), false)
check('four chasers shareable',      canShare(ctx(M.chaserArak, { qty: 4 })), true)
check('single premium chaser NOT shareable', canShare(ctx(M.chaserBeluga, { qty: 1 })), false)
check('four premium chasers shareable',      canShare(ctx(M.chaserBeluga, { qty: 4 })), true)

/* ── 8. validateLine — the gate every write passes through ────────── */

check('valid: shared pizza',
  validateLine(ctx(M.pizza), true).ok, true)
check('valid: individual pizza (shareable ≠ mandatory)',
  validateLine(ctx(M.pizza), false).ok, true)
check('invalid: cola marked shared',
  validateLine(ctx(M.cola), true).reason, 'not-shareable')
check('valid: cola on a person',
  validateLine(ctx(M.cola), false).ok, true)
check('invalid: single cocktail marked shared',
  validateLine(ctx(M.cocktailDual, { v: 0 }), true).reason, 'not-shareable')
check('valid: cocktail jug marked shared',
  validateLine(ctx(M.cocktailDual, { v: 1 }), true).ok, true)
check('invalid: 2 chasers',
  validateLine(ctx(M.chaserArak, { qty: 2 }), false).reason, 'qty')
check('invalid: single chaser marked shared',
  validateLine(ctx(M.chaserArak, { qty: 1 }), true).reason, 'not-shareable')
check('valid: 4 chasers shared',
  validateLine(ctx(M.chaserArak, { qty: 4 }), true).ok, true)
check('valid: 4 chasers on one person (a round for themselves)',
  validateLine(ctx(M.chaserArak, { qty: 4 }), false).ok, true)
check('qty error is trilingual',
  Object.keys(validateLine(ctx(M.chaserArak, { qty: 2 }), false).message).sort(),
  ['ar', 'en', 'he'])
check('share error is trilingual',
  Object.keys(validateLine(ctx(M.cola), true).message).sort(),
  ['ar', 'en', 'he'])

/* ── report ───────────────────────────────────────────────────────── */

const total = pass + failures.length
if (failures.length) {
  console.error(`\n✗ ${failures.length}/${total} failed:\n`)
  for (const f of failures) console.error(`  • ${f}\n`)
  process.exit(1)
}
console.log(`✓ shareable rules — ${pass}/${total} checks passed`)
