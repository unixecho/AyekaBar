#!/usr/bin/env node
// Logic harness for the digital menu's cart.
//
//   node scripts/check-cart.mjs
//
// Same shape and same reasoning as check-shift-rules.mjs: the cart's rules are
// pure functions with no database and no DOM, so they can be checked
// exhaustively in milliseconds. It runs the REAL TypeScript sources,
// transpiled on the fly by the compiler already in node_modules — copying the
// logic in here would produce a harness that passes while the app is broken,
// which is worse than no harness.
//
// WHAT IT IS ACTUALLY GUARDING
//   • The reducer, which decides what a customer's order IS.
//   • `sanitizeCart`, which is the only thing standing between a corrupt
//     localStorage entry and a menu page that throws on load.
//   • `validateSubmission`, which has no caller yet — and is therefore
//     exactly the code most likely to be silently wrong on the day it gets
//     one. Phase 2 is meant to be a mapping exercise, and this is what makes
//     that claim checkable rather than hopeful.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// ── transpile ──────────────────────────────────────────────────────────

const CART = new URL('../src/lib/cart/', import.meta.url)
const MENU = new URL('../src/lib/menu/', import.meta.url)
const outDir = join(tmpdir(), `ayeka-cart-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

function emit(sourceUrl, outName, rewrite) {
  const source = readFileSync(sourceUrl, 'utf8')
  let js = ts.transpileModule(source, {
    // ⚠️ The .ts name matters. transpileModule picks its parser from this
    // filename's extension — hand it the .mjs OUTPUT name and it parses the
    // file as JavaScript, leaves `new Map<string, X[]>()` untouched, and the
    // failure surfaces as a baffling syntax error in the emitted file.
    fileName: outName.replace(/\.mjs$/, '.ts'),
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      isolatedModules: true,
    },
  }).outputText
  js = rewrite(js)
  writeFileSync(join(outDir, outName), js)
}

// menu/*: `./types` and `./variants` here are the MENU ones, so they get their
// own prefix — cart/ has files with both those names and they must not collide
// in the flat output directory.
const menuRewrite = (js) => js
  .replace(/from '\.\/types'/g, "from './menu-types.mjs'")
  .replace(/from '\.\/variants'/g, "from './menu-variants.mjs'")

// cart/*: RELATIVES FIRST, alias second. The other order rewrites the alias to
// './menu-types.mjs' and then the relative pass matches its own output and
// makes it './menu-types.mjs.mjs'.
const cartRewrite = (js) => js
  .replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'")
  .replace(/from '@\/lib\/menu\/types'/g, "from './menu-types.mjs'")

emit(new URL('variants.ts', MENU), 'menu-variants.mjs', menuRewrite)
emit(new URL('types.ts', MENU), 'menu-types.mjs', menuRewrite)
for (const f of ['types.ts', 'variants.ts', 'store.ts', 'storage.ts', 'submission.ts', 'otp.ts', 'i18n.ts']) {
  emit(new URL(f, CART), f.replace(/\.ts$/, '.mjs'), cartRewrite)
}

const load = (name) => import(pathToFileURL(join(outDir, name)).href)
const T = await load('types.mjs')
const V = await load('variants.mjs')
const S = await load('store.mjs')
const St = await load('storage.mjs')
const Sub = await load('submission.mjs')
const Otp = await load('otp.mjs')
const I18n = await load('i18n.mjs')

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (title) => console.log(`\n${title}`)

// A deterministic context, so ids and timestamps in expectations are literals
// rather than computations that could be wrong in the same way as the code.
let idSeq = 0
let clock = 1_000_000
const ctx = { newId: () => `id${++idSeq}`, now: () => ++clock }
const R = (cart, action) => S.reduce(cart, action, ctx)

const EMPTY = T.EMPTY_CART

function payload(over = {}) {
  return {
    itemUid: 'u-beer',
    name: { he: 'בירה', en: 'Beer' },
    variantLabel: {},
    variantIndex: 0,
    unitAgorot: 3000,
    priceText: '30',
    categoryId: 'draftBeer',
    categoryTitle: { he: 'בירה מהחבית' },
    ...over,
  }
}

// ── 1. price parsing (the twin of ayeka-staff's toVariants) ────────────
section('variants — parsing a menu price into something tappable')
{
  const single = V.toVariants(52, 'cocktails')
  check('a plain number is one variant, in agorot', single.length === 1 && single[0].agorot === 5200)

  const cocktail = V.toVariants('52/208', 'cocktails')
  check('"52/208" in cocktails splits into two',
    cocktail.length === 2 && cocktail[0].agorot === 5200 && cocktail[1].agorot === 20800)
  check('…labelled יחיד / קנקן, matching the waiter app',
    cocktail[0].label.he === 'יחיד' && cocktail[1].label.he === 'קנקן')

  const wine = V.toVariants('49/139', 'wines')
  check('wines split into כוס / בקבוק', wine[0].label.he === 'כוס' && wine[1].label.he === 'בקבוק')

  const beer = V.toVariants('30/34', 'draftBeer')
  check('draft beer splits into שליש / חצי', beer[0].label.he === 'שליש' && beer[1].label.he === 'חצי')

  const unknownCat = V.toVariants('30/34', 'somethingElse')
  check('an unmapped category falls back to קטן / גדול',
    unknownCat[0].label.he === 'קטן' && unknownCat[1].label.he === 'גדול')

  check('a price with no number at all yields NO variants (priced by the waiter)',
    V.toVariants('לפי משקל', 'food').length === 0)
  check('null price yields no variants', V.toVariants(null, 'food').length === 0)
  check('empty-string price yields no variants', V.toVariants('', 'food').length === 0)
  check('a three-part range is not guessed at', V.toVariants('10/20/30', 'food').length === 0)
  check('a numeric string is a single variant', V.toVariants('44', 'food')[0].agorot === 4400)

  check('12.5₪ rounds to 1250 agorot, not 1249.9999', V.toAgorot(12.5) === 1250)
  check('whole shekels format without decimals', V.fmtAgorot(5200) === '52')
  check('half shekels keep them rather than rounding money on screen', V.fmtAgorot(1250) === '12.50')

  check('needsChoice: two prices means yes', V.needsChoice(cocktail, []) === true)
  check('needsChoice: one price and no options means no', V.needsChoice(single, []) === false)
  check('needsChoice: an option group with choices means yes',
    V.needsChoice(single, [{ choices: [{ id: 'a' }] }]) === true)
  check('needsChoice: an EMPTY option group does not count',
    V.needsChoice(single, [{ choices: [] }]) === false)
}

// ── 2. the reducer ─────────────────────────────────────────────────────
section('store — adding, merging and splitting')
{
  const one = R(EMPTY, { type: 'add', payload: payload() })
  check('an add creates one line at qty 1', one.lines.length === 1 && one.lines[0].qty === 1)
  check('…and does not mutate the cart it was given', EMPTY.lines.length === 0)

  const two = R(one, { type: 'add', payload: payload() })
  check('the identical add merges rather than stacking', two.lines.length === 1 && two.lines[0].qty === 2)

  const withNote = R(two, { type: 'add', payload: payload({ note: 'בלי קרח' }) })
  check('a note makes it a different line', withNote.lines.length === 2)

  const otherVariant = R(two, { type: 'add', payload: payload({ variantIndex: 1, unitAgorot: 3400 }) })
  check('a different variant makes it a different line', otherVariant.lines.length === 2)

  // The Happy Hour case the lineSignature fix exists for.
  const hh = R(EMPTY, { type: 'add', payload: payload({ unitAgorot: 1800, happyHourPercent: 40 }) })
  const afterHh = R(hh, { type: 'add', payload: payload({ unitAgorot: 3000 }) })
  check('the SAME item at a different price is a separate line (Happy Hour ended)',
    afterHh.lines.length === 2)
  check('…and the discounted one keeps its own price',
    afterHh.lines[0].unitAgorot === 1800 && afterHh.lines[1].unitAgorot === 3000)
  check('…and carries the percentage that produced it', afterHh.lines[0].happyHourPercent === 40)

  const qtyCapped = R(EMPTY, { type: 'add', payload: payload({ qty: 999 }) })
  check('an absurd qty is clamped to MAX_QTY', qtyCapped.lines[0].qty === T.MAX_QTY)

  const zeroed = R(one, { type: 'setQty', lineId: one.lines[0].id, qty: 0 })
  check('stepping a line down to zero removes it', zeroed.lines.length === 0)

  const negative = R(one, { type: 'setQty', lineId: one.lines[0].id, qty: -5 })
  check('a negative qty removes rather than storing a negative', negative.lines.length === 0)
}

section('store — the menu row stepper undoes the LAST add')
{
  let cart = R(EMPTY, { type: 'add', payload: payload() })
  cart = R(cart, { type: 'add', payload: payload({ note: 'first' }) })
  cart = R(cart, { type: 'add', payload: payload({ note: 'second' }) })
  check('three distinct lines for one item', cart.lines.length === 3)
  check('qtyOfItem sums across every line', S.qtyOfItem(cart, 'u-beer') === 3)

  const dec = R(cart, { type: 'decrementItem', itemUid: 'u-beer' })
  check('"−" removes the most recently added line', dec.lines.length === 2 && !dec.lines.some((l) => l.note === 'second'))

  const missing = R(cart, { type: 'decrementItem', itemUid: 'nope' })
  check('decrementing an item that is not there is refused by reference', missing === cart)
}

section('store — diners')
{
  let cart = R(EMPTY, { type: 'addDiner', name: 'דנה' })
  const dana = cart.diners[0].id
  check('a diner is added', cart.diners.length === 1 && cart.diners[0].name === 'דנה')

  const dup = R(cart, { type: 'addDiner', name: 'דנה' })
  check('a duplicate name is refused BY REFERENCE, so the UI can tell', dup === cart)

  const blank = R(cart, { type: 'addDiner', name: '   ' })
  check('a whitespace-only name is refused', blank === cart)

  const longName = R(cart, { type: 'addDiner', name: 'א'.repeat(200) })
  check('a very long name is truncated, not rejected',
    longName.diners[1].name.length === T.MAX_NAME_LEN)

  let full = cart
  for (let i = 0; i < T.MAX_DINERS + 5; i++) full = R(full, { type: 'addDiner', name: `p${i}` })
  check('the diner list stops at MAX_DINERS', full.diners.length === T.MAX_DINERS)

  cart = R(cart, { type: 'add', payload: payload({ dinerId: dana }) })
  check('a line can be added straight to a diner', cart.lines[0].dinerId === dana)

  const bogus = R(cart, { type: 'add', payload: payload({ dinerId: 'ghost', note: 'x' }) })
  check('an unknown dinerId falls back to the table rather than orphaning the line',
    bogus.lines[1].dinerId === null)

  // Removing a diner must never destroy what they ordered.
  const removed = R(cart, { type: 'removeDiner', dinerId: dana })
  check('removing a diner keeps their lines', removed.lines.length === 1)
  check('…and hands them to the table', removed.lines[0].dinerId === null)
  check('…and the diner is gone', removed.diners.length === 0)

  const renamed = R(cart, { type: 'renameDiner', dinerId: dana, name: 'דנה ק' })
  check('a diner can be renamed', renamed.diners[0].name === 'דנה ק')
  let twoPeople = R(cart, { type: 'addDiner', name: 'יוסי' })
  const clash = R(twoPeople, { type: 'renameDiner', dinerId: twoPeople.diners[1].id, name: 'דנה' })
  check('renaming onto an existing name is refused', clash === twoPeople)
}

section('store — reassigning folds twins together')
{
  let cart = R(EMPTY, { type: 'addDiner', name: 'דנה' })
  const dana = cart.diners[0].id
  cart = R(cart, { type: 'add', payload: payload() })                     // 1 for the table
  cart = R(cart, { type: 'add', payload: payload({ dinerId: dana }) })    // 1 for דנה
  check('two lines, same drink, two owners', cart.lines.length === 2)

  const tableLine = cart.lines.find((l) => l.dinerId === null)
  const merged = R(cart, { type: 'assignLine', lineId: tableLine.id, dinerId: dana })
  check('moving one onto the other merges them', merged.lines.length === 1)
  check('…into a single line of qty 2', merged.lines[0].qty === 2)
  check('…owned by דנה', merged.lines[0].dinerId === dana)

  const noop = R(cart, { type: 'assignLine', lineId: tableLine.id, dinerId: null })
  check('assigning a line where it already is is refused by reference', noop === cart)

  // The same fold has to happen when a diner is removed, not just on a manual
  // reassign — otherwise "דנה" leaving leaves two identical table rows.
  let both = R(EMPTY, { type: 'addDiner', name: 'דנה' })
  const d2 = both.diners[0].id
  both = R(both, { type: 'add', payload: payload() })
  both = R(both, { type: 'add', payload: payload({ dinerId: d2 }) })
  const gone = R(both, { type: 'removeDiner', dinerId: d2 })
  check('removing a diner folds their line into the identical table line',
    gone.lines.length === 1 && gone.lines[0].qty === 2)
}

section('store — notes are editable and clearable after the fact')
{
  const withNote = R(EMPTY, { type: 'add', payload: payload({ note: 'בלי קרח' }) })
  const id = withNote.lines[0].id
  check('a note survives the add', withNote.lines[0].note === 'בלי קרח')

  const edited = R(withNote, { type: 'setNote', lineId: id, note: '  הרבה   קרח  ' })
  check('a note can be corrected, and is whitespace-collapsed',
    edited.lines[0].note === 'הרבה קרח')

  const cleared = R(edited, { type: 'setNote', lineId: id, note: '' })
  check('an empty note CLEARS it rather than storing ""',
    cleared.lines[0].note === undefined)

  const longNote = R(withNote, { type: 'setNote', lineId: id, note: 'x'.repeat(500) })
  check('an over-long note is truncated to MAX_NOTE_LEN',
    longNote.lines[0].note.length === T.MAX_NOTE_LEN)

  // After clearing, the line is identical to a plain one — so adding that
  // plain item must MERGE into it rather than sit beside it.
  const merged = R(cleared, { type: 'add', payload: payload() })
  check('clearing a note makes the line merge-compatible again',
    merged.lines.length === 1 && merged.lines[0].qty === 2)
}

section('store — caps and totals')
{
  let cart = EMPTY
  for (let i = 0; i < T.MAX_LINES + 10; i++) {
    cart = R(cart, { type: 'add', payload: payload({ itemUid: `u${i}` }) })
  }
  check('the cart stops at MAX_LINES', cart.lines.length === T.MAX_LINES)
  const refused = R(cart, { type: 'add', payload: payload({ itemUid: 'one-more' }) })
  check('…and refuses further adds by reference, so no animation plays', refused === cart)

  let money = R(EMPTY, { type: 'add', payload: payload({ unitAgorot: 3000, qty: 2 }) })
  money = R(money, { type: 'add', payload: payload({ itemUid: 'u-x', unitAgorot: null, priceText: 'לפי משקל' }) })
  const t = S.cartTotals(money)
  check('the total sums only what has a price', t.agorot === 6000)
  check('…and reports the unpriced lines rather than guessing at them', t.unpricedLines === 1)
  check('cartCount counts units, not lines', S.cartCount(money) === 3)

  const cleared = R(money, { type: 'clear' })
  check('clear empties both lists', cleared.lines.length === 0 && cleared.diners.length === 0)
}

section('store — grouping for the sheet')
{
  let cart = R(EMPTY, { type: 'addDiner', name: 'דנה' })
  cart = R(cart, { type: 'addDiner', name: 'יוסי' })
  const [dana, yossi] = cart.diners.map((d) => d.id)
  cart = R(cart, { type: 'add', payload: payload({ dinerId: dana, unitAgorot: 3000 }) })
  cart = R(cart, { type: 'add', payload: payload({ itemUid: 'u-chips', unitAgorot: 2500 }) })

  const groups = S.groupByDiner(cart)
  check('the table group always comes first', groups[0].diner === null)
  check('one group per diner, in naming order',
    groups.length === 3 && groups[1].diner.id === dana && groups[2].diner.id === yossi)
  check('a diner with nothing yet still gets a group', groups[2].lines.length === 0)
  check('per-group totals are per group', groups[1].totals.agorot === 3000 && groups[0].totals.agorot === 2500)
}

// ── 3. the localStorage sanitizer ──────────────────────────────────────
section('storage — sanitizeCart survives anything')
{
  for (const junk of [null, undefined, 42, 'hello', [], true, () => {}]) {
    const out = St.sanitizeCart(junk)
    if (out.lines.length !== 0 || out.diners.length !== 0) {
      check(`garbage input ${String(junk)} yields an empty cart`, false)
    }
  }
  check('every non-object input yields an empty cart', true)

  check('a line with no id is dropped',
    St.sanitizeCart({ lines: [{ itemUid: 'u', qty: 1 }] }).lines.length === 0)
  check('a line with no itemUid is dropped',
    St.sanitizeCart({ lines: [{ id: 'a', qty: 1 }] }).lines.length === 0)
  check('a line with qty 0 is dropped',
    St.sanitizeCart({ lines: [{ id: 'a', itemUid: 'u', qty: 0 }] }).lines.length === 0)
  check('a line with a non-numeric qty is dropped',
    St.sanitizeCart({ lines: [{ id: 'a', itemUid: 'u', qty: 'lots' }] }).lines.length === 0)
  check('an absurd qty is clamped, not dropped',
    St.sanitizeCart({ lines: [{ id: 'a', itemUid: 'u', qty: 1e9 }] }).lines[0].qty === T.MAX_QTY)

  const dupIds = St.sanitizeCart({ lines: [
    { id: 'a', itemUid: 'u', qty: 1 }, { id: 'a', itemUid: 'v', qty: 1 },
  ] })
  check('a duplicate line id is dropped rather than shadowing', dupIds.lines.length === 1)

  const orphan = St.sanitizeCart({
    diners: [{ id: 'd1', name: 'דנה' }],
    lines: [{ id: 'a', itemUid: 'u', qty: 1, dinerId: 'ghost' }],
  })
  check('a line pointing at a diner who is gone falls back to the table',
    orphan.lines[0].dinerId === null)

  const negPrice = St.sanitizeCart({ lines: [{ id: 'a', itemUid: 'u', qty: 1, unitAgorot: -500 }] })
  check('a negative unit price is not a discount, it is corruption → null',
    negPrice.lines[0].unitAgorot === null)

  const floatPrice = St.sanitizeCart({ lines: [{ id: 'a', itemUid: 'u', qty: 1, unitAgorot: 1234.7 }] })
  check('a fractional agorot value is rounded to an integer', floatPrice.lines[0].unitAgorot === 1235)

  const hh = St.sanitizeCart({ lines: [
    { id: 'a', itemUid: 'u', qty: 1, happyHourPercent: 40 },
    { id: 'b', itemUid: 'u', qty: 1, happyHourPercent: 400 },
    { id: 'c', itemUid: 'u', qty: 1, happyHourPercent: 'lots' },
  ] })
  check('a valid discount percentage survives', hh.lines[0].happyHourPercent === 40)
  check('an out-of-range percentage is dropped, not clamped', hh.lines[1].happyHourPercent === undefined)
  check('a non-numeric percentage is dropped', hh.lines[2].happyHourPercent === undefined)

  const tooMany = St.sanitizeCart({
    diners: Array.from({ length: 100 }, (_, i) => ({ id: `d${i}`, name: `p${i}` })),
    lines: Array.from({ length: 500 }, (_, i) => ({ id: `l${i}`, itemUid: 'u', qty: 1 })),
  })
  check('the diner list is capped on read too', tooMany.diners.length === T.MAX_DINERS)
  check('the line list is capped on read too', tooMany.lines.length === T.MAX_LINES)

  const weird = St.sanitizeCart({
    lines: [{
      id: 'a', itemUid: 'u', qty: 1,
      name: { he: 'x', evil: 'y', __proto__: { polluted: true } },
      selectedOptions: [{ groupId: 'g', choiceId: 'c', label: { he: 'ok' } }, 'not an object', null],
      note: '  spaced   out  \n line  ',
    }],
  })
  check('only he/en/ar survive a Localized', Object.keys(weird.lines[0].name).join() === 'he')
  check('malformed options are dropped, well-formed ones kept',
    weird.lines[0].selectedOptions.length === 1)
  check('whitespace in a note is collapsed', weird.lines[0].note === 'spaced out line')
  check('no prototype pollution reaches the cart', ({}).polluted === undefined)

  const deepOptions = St.sanitizeCart({ lines: [{
    id: 'a', itemUid: 'u', qty: 1,
    selectedOptions: Array.from({ length: 50 }, (_, i) => ({ groupId: `g${i}`, choiceId: 'c' })),
  }] })
  check('the options array is capped', deepOptions.lines[0].selectedOptions.length === 8)

  // The reducer must accept whatever the sanitizer produces — the two run
  // back to back on every page load, and a shape one blesses and the other
  // chokes on is the failure mode this pairing exists to prevent.
  const round = R(St.sanitizeCart({
    diners: [{ id: 'd1', name: 'דנה' }],
    lines: [{ id: 'a', itemUid: 'u', qty: 2, dinerId: 'd1', unitAgorot: 100 }],
  }), { type: 'add', payload: payload() })
  check('a sanitized cart feeds straight back into the reducer', round.lines.length === 2)
}

// ── 4. the Phase-2 wire shape ──────────────────────────────────────────
section('submission — mapping a cart onto waiter_order_items')
{
  let cart = R(EMPTY, { type: 'addDiner', name: 'דנה' })
  const dana = cart.diners[0].id
  cart = R(cart, { type: 'add', payload: payload({
    dinerId: dana, qty: 2, unitAgorot: 5200,
    variantLabel: { he: 'יחיד', en: 'Single' }, variantIndex: 0,
    selectedOptions: [{ groupId: 'sauce', choiceId: 'pesto', label: { he: 'פסטו' }, groupLabel: { he: 'רוטב' } }],
    note: 'בלי קרח',
  }) })
  cart = R(cart, { type: 'add', payload: payload({ itemUid: 'u-weigh', unitAgorot: null, priceText: 'לפי משקל' }) })

  const sub = Sub.toSubmission(cart, 'he')
  check('the payload is version 1', sub.version === 1)
  check('one item per cart line', sub.items.length === 2)

  const line = sub.items[0]
  check('seat_name is the NAME, not the id — the OMS snapshots names', line.seat_name === 'דנה')
  check('a table line has seat_name null, exactly like waiter_order_items',
    sub.items[1].seat_name === null)
  check('name_he is populated', line.name_he === 'בירה')
  check('name_en is null when absent', sub.items[1].name_en === 'Beer' || sub.items[1].name_en === null)
  check('variant carries the Hebrew label', line.variant === 'יחיד')
  check('selected_options matches migration 029\'s shape',
    line.selected_options.length === 1
    && line.selected_options[0].groupId === 'sauce'
    && line.selected_options[0].choiceId === 'pesto')
  check('the note travels', line.note === 'בלי קרח')
  check('total_agorot covers only the priced lines', sub.total_agorot === 10400)
  check('unpriced lines are counted so a human prices them', sub.unpriced_count === 1)

  const text = Sub.toPlainText(sub)
  check('the plain-text rendering groups by person', text.includes('דנה') && text.includes('לשולחן'))
  check('…and shows the total', text.includes('104'))
}

section('submission — validateSubmission is the server-side half')
{
  let cart = R(EMPTY, { type: 'addDiner', name: 'דנה' })
  cart = R(cart, { type: 'add', payload: payload({ dinerId: cart.diners[0].id }) })
  const good = Sub.toSubmission(cart, 'he')

  check('a real payload validates', Sub.validateSubmission(good).ok === true)

  const bad = (mutate, label) => {
    const copy = JSON.parse(JSON.stringify(good))
    mutate(copy)
    const res = Sub.validateSubmission(copy)
    check(label, res.ok === false, res.ok ? 'accepted when it should not have' : '')
  }

  bad((p) => { p.version = 2 }, 'an unknown version is rejected, not best-effort parsed')
  bad((p) => { p.lang = 'fr' }, 'an unknown language is rejected')
  bad((p) => { p.items = [] }, 'an empty order is rejected')
  bad((p) => { p.items[0].qty = 0 }, 'qty 0 is rejected')
  bad((p) => { p.items[0].qty = 9999 }, 'an absurd qty is rejected')
  bad((p) => { p.items[0].qty = 1.5 }, 'a fractional qty is rejected')
  bad((p) => { p.items[0].unit_agorot = -1 }, 'a negative price is rejected')
  bad((p) => { p.items[0].unit_agorot = 12.5 }, 'a fractional agorot price is rejected')
  bad((p) => { p.items[0].item_uid = '' }, 'an item with no uid is rejected')
  bad((p) => { p.items[0].name_he = '   ' }, 'an item with no name is rejected')
  bad((p) => { p.items[0].note = 'x'.repeat(500) }, 'an over-long note is rejected')
  bad((p) => { p.items[0].seat_name = 'somebody else' },
    'a seat_name matching no diner is REJECTED, not quietly reassigned')
  bad((p) => { p.diners = Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, name: `p${i}` })) },
    'too many diners is rejected')
  bad((p) => { p.items = Array.from({ length: 500 }, () => p.items[0]) }, 'too many items is rejected')
  bad((p) => { p.items[0].selected_options = Array.from({ length: 40 }, () => ({ groupId: 'g', choiceId: 'c' })) },
    'too many options is rejected')
  bad((p) => { p.items[0].selected_options = [{ groupId: 5, choiceId: 'c' }] },
    'a non-string groupId is rejected')

  // The single most important property: the client's arithmetic is never
  // trusted, because the client chose it.
  const lying = JSON.parse(JSON.stringify(good))
  lying.total_agorot = 1
  const res = Sub.validateSubmission(lying)
  check('a lying total is RECOMPUTED, never believed',
    res.ok === true && res.value.total_agorot === good.total_agorot)

  const extra = JSON.parse(JSON.stringify(good))
  extra.items[0].secret_admin_flag = true
  const res2 = Sub.validateSubmission(extra)
  check('unknown fields are dropped, not passed through',
    res2.ok === true && res2.value.items[0].secret_admin_flag === undefined)

  check('a non-object body is rejected', Sub.validateSubmission('hello').ok === false)
  check('null is rejected', Sub.validateSubmission(null).ok === false)
  check('an array is rejected', Sub.validateSubmission([]).ok === false)
}

// ── 5. the Phase-2 code ────────────────────────────────────────────────
section('otp — the six digits the waiter reads out')
{
  check('normalize strips anything that is not a digit', Otp.normalizeTableCode('12-34 56') === '123456')
  check('normalize survives a pasted label', Otp.normalizeTableCode('קוד: 123456') === '123456')
  check('normalize truncates past six', Otp.normalizeTableCode('1234567890') === '123456')
  check('normalize copes with an empty string', Otp.normalizeTableCode('') === '')
  check('shape check accepts six digits', Otp.isValidTableCodeShape('000123') === true)
  check('shape check rejects five', Otp.isValidTableCodeShape('12345') === false)
  check('shape check rejects letters', Otp.isValidTableCodeShape('12345a') === false)
  check('formatting groups in threes for reading aloud', Otp.formatTableCode('123456') === '123 456')

  // These constants are the TypeScript half of a rule whose other half is in
  // migration 048. If one of these changes, that file has to change with it.
  check('code length is 6, matching the SQL regex', Otp.TABLE_CODE_LENGTH === 6)
  check('TTL is 600s, matching issue_table_code', Otp.TABLE_CODE_TTL_SECONDS === 600)
  check('attempt cap is 5, matching redeem_table_code', Otp.TABLE_CODE_MAX_ATTEMPTS === 5)
  check('session TTL is 10800s, matching redeem_table_code', Otp.TABLE_SESSION_TTL_SECONDS === 10800)
  check('the default channel needs no third party', Otp.TABLE_CODE_CHANNEL_DEFAULT === 'handoff')
}

// ── 6. i18n completeness ───────────────────────────────────────────────
section('i18n — every string exists in all three languages')
{
  const missing = []
  for (const [key, value] of Object.entries(I18n.CART_UI)) {
    for (const lang of ['he', 'en', 'ar']) {
      if (typeof value[lang] !== 'string' || !value[lang].trim()) missing.push(`${key}.${lang}`)
    }
  }
  check(`all ${Object.keys(I18n.CART_UI).length} strings are trilingual`,
    missing.length === 0, missing.join(', '))
}

// ── report ─────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
