#!/usr/bin/env node
// Logic harness for the 86 list (items and categories taken off the menu).
//
//   node scripts/check-archive.mjs
//
// Same shape and reasoning as check-cart.mjs: the take-off / bring-back rules
// are pure functions with no database and no DOM, so they can be checked
// exhaustively in milliseconds. It runs the REAL src/lib/menu/archive.ts,
// transpiled on the fly by the compiler already in node_modules.
//
// WHAT IT IS ACTUALLY GUARDING
//   • Nothing is ever lost: whatever comes off the menu can be put back whole.
//   • Bringing something back twice does not duplicate it.
//   • The draft and the published copy can be operated on independently — the
//     published side may not have the item, or may know it under another uid.
//   • A stale click (the menu moved between the tap and the request) is
//     refused instead of 86'ing the wrong dish.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const outDir = join(tmpdir(), `ayeka-archive-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

const source = readFileSync(new URL('../src/lib/menu/archive.ts', import.meta.url), 'utf8')
writeFileSync(join(outDir, 'archive.mjs'), ts.transpileModule(source, {
  fileName: 'archive.ts',
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
}).outputText)

const A = await import(pathToFileURL(join(outDir, 'archive.mjs')).href)

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (title) => console.log(`\n${title}`)
// Structural, not JSON.stringify: two objects with the same fields in a
// different key order are the same data, and comparing text calls them different.
const same = (a, b) => isDeepStrictEqual(a, b)

let seq = 0
const newUid = () => `minted${++seq}`

const menu = () => [
  { id: 'pizzas', icon: '🍕', title: { he: 'פיצות' }, items: [
    { uid: 'p1', he: 'מרגריטה', price: 52 },
    { uid: 'p2', he: 'פפרוני', price: 58 },
    { uid: 'p3', he: 'פטריות', price: 56 },
  ] },
  { id: 'cocktails', icon: '🍹', title: { he: 'קוקטיילים', en: 'Cocktails' }, items: [
    { uid: 'c1', he: 'מוחיטו', price: '52/208' },
  ] },
  { id: 'desserts', icon: '🍰', title: { he: 'קינוחים' }, items: [
    { he: 'טירמיסו', price: 38 },          // predates uids
    { he: 'עוגת גבינה', price: 36 },       // predates uids
  ] },
]

const names = (cats, id) => (cats.find((c) => c.id === id)?.items ?? []).map((i) => i.he)

const entryFor = (r, over = {}) => ({
  id: 'e1', kind: 'item', archivedAt: '2026-09-29T10:00:00.000Z', archivedBy: 'דנה',
  item: r.item, from: r.from, ...over,
})

// ── 1. taking an item off ──────────────────────────────────────────────
section('takeItem — one dish comes off, the rest stay put')
{
  const before = menu()
  const snapshot = JSON.stringify(before)
  const r = A.takeItem(before, 'pizzas', { uid: 'p2' }, newUid)

  check('taking by uid succeeds', r.ok === true)
  check('the dish is gone from its category', same(names(r.categories, 'pizzas'), ['מרגריטה', 'פטריות']))
  check('other categories are untouched', same(r.categories[1], before[1]) && same(r.categories[2], before[2]))
  check('it remembers exactly where it was', r.from.categoryId === 'pizzas' && r.from.itemIndex === 1 && r.from.categoryIndex === 0)
  check('it remembers the category, in case that goes too',
    r.from.title.he === 'פיצות' && r.from.icon === '🍕')
  check('the input is not mutated', JSON.stringify(before) === snapshot)
  check('the item keeps its own uid — variants and happy hour still point at it', r.item.uid === 'p2')

  const legacy = A.takeItem(menu(), 'desserts', { index: 0 }, newUid)
  check('an item that never had a uid is taken by position', legacy.ok && legacy.item.he === 'טירמיסו')
  check('…and is given one, so it can be recognised when it comes back',
    typeof legacy.item.uid === 'string' && legacy.item.uid.startsWith('minted'))

  check('an unknown uid is item-missing', A.takeItem(menu(), 'pizzas', { uid: 'nope' }, newUid).reason === 'item-missing')
  check('an unknown category is category-missing', A.takeItem(menu(), 'nope', { uid: 'p1' }, newUid).reason === 'category-missing')
  check('no reference at all is item-missing', A.takeItem(menu(), 'pizzas', {}, newUid).reason === 'item-missing')
  check('an index past the end is item-missing', A.takeItem(menu(), 'desserts', { index: 9 }, newUid).reason === 'item-missing')
  check('an index that now lands on an item WITH a uid is stale, not a guess',
    A.takeItem(menu(), 'pizzas', { index: 0 }, newUid).reason === 'stale')
}

// ── 2. the published copy ──────────────────────────────────────────────
section('dropItem — the live copy comes off too')
{
  const taken = A.takeItem(menu(), 'pizzas', { uid: 'p2' }, newUid)
  const live = A.dropItem(menu(), 'pizzas', taken.item)
  check('removed from the published copy by uid', same(names(live, 'pizzas'), ['מרגריטה', 'פטריות']))

  const neverLive = A.dropItem([{ ...menu()[0], items: [menu()[0].items[0]] }], 'pizzas', taken.item)
  check('an item that was never published is a quiet no-op', same(names(neverLive, 'pizzas'), ['מרגריטה']))

  // The two copies mint uids independently until the next publish.
  const otherUid = menu()
  otherUid[0].items[1] = { uid: 'DIFFERENT', he: 'פפרוני', price: 58 }
  const viaText = A.dropItem(otherUid, 'pizzas', taken.item)
  check('falls back to name+price when the published side knows it under another uid',
    same(names(viaText, 'pizzas'), ['מרגריטה', 'פטריות']))

  const lookalike = menu()
  lookalike[0].items[1] = { uid: 'x', he: 'פפרוני', price: 99 }
  const notFooled = A.dropItem(lookalike, 'pizzas', taken.item)
  check('a same-named dish at a different price is left alone', names(notFooled, 'pizzas').length === 3)

  const wrongCat = A.dropItem(menu(), 'cocktails', taken.item)
  check('only ever touches the named category', same(wrongCat, menu()))
}

// ── 3. taking a category off ───────────────────────────────────────────
section('takeCategory / dropCategory')
{
  const r = A.takeCategory(menu(), 'cocktails')
  check('the category leaves with all its items', r.ok && r.category.items.length === 1 && r.categories.length === 2)
  check('its old position is recorded', r.index === 1)
  check('an unknown category is refused', A.takeCategory(menu(), 'nope').ok === false)
  check('dropCategory removes it from the published copy', A.dropCategory(menu(), 'pizzas').length === 2)
  check('dropCategory of something absent is a no-op', same(A.dropCategory(menu(), 'nope'), menu()))
}

// ── 4. bringing an item back ───────────────────────────────────────────
section('putItem — back exactly where it was')
{
  const taken = A.takeItem(menu(), 'pizzas', { uid: 'p2' }, newUid)
  const back = A.putItem(taken.categories, entryFor(taken))
  check('round trip restores the menu exactly', same(back, menu()))

  const twice = A.putItem(back, entryFor(taken))
  check('bringing it back a second time does not duplicate it', same(twice, menu()))

  const first = A.takeItem(menu(), 'pizzas', { uid: 'p1' }, newUid)
  const last = A.takeItem(first.categories, 'pizzas', { uid: 'p3' }, newUid)
  const backLast = A.putItem(last.categories, entryFor(last))
  const backFirst = A.putItem(backLast, entryFor(first))
  check('items 86’d one after another all come back in their original order', same(names(backFirst, 'pizzas'), ['מרגריטה', 'פפרוני', 'פטריות']))

  const shrunk = A.takeItem(menu(), 'pizzas', { uid: 'p3' }, newUid)
  const fewer = shrunk.categories.map((c) => (c.id === 'pizzas' ? { ...c, items: c.items.slice(0, 1) } : c))
  const clamped = A.putItem(fewer, entryFor(shrunk))
  check('a position past the end of a shorter list goes to the end, not nowhere',
    names(clamped, 'pizzas').at(-1) === 'פטריות')

  const noCat = A.takeItem(menu(), 'cocktails', { uid: 'c1' }, newUid)
  const withoutCat = noCat.categories.filter((c) => c.id !== 'cocktails')
  const rebuilt = A.putItem(withoutCat, entryFor(noCat))
  const rebuiltCat = rebuilt.find((c) => c.id === 'cocktails')
  check('if its category is gone it is rebuilt from what the entry remembers',
    rebuiltCat?.icon === '🍹' && rebuiltCat.title.en === 'Cocktails' && names(rebuilt, 'cocktails')[0] === 'מוחיטו')
  check('…in the right slot among the categories', rebuilt.findIndex((c) => c.id === 'cocktails') === 1)

  const legacy = A.takeItem(menu(), 'desserts', { index: 1 }, newUid)
  const backLegacy = A.putItem(legacy.categories, entryFor(legacy))
  check('a uid-less item minted at 86 time comes back once, by name and price',
    A.putItem(backLegacy, entryFor(legacy)).find((c) => c.id === 'desserts').items.length === 2)
}

// ── 5. bringing a category back ────────────────────────────────────────
section('putCategory — whole, and merged when something is already there')
{
  const r = A.takeCategory(menu(), 'cocktails')
  const entry = { id: 'e2', kind: 'category', archivedAt: '2026-09-29T10:00:00.000Z', archivedBy: null, category: r.category, categoryIndex: r.index }
  check('round trip restores the menu exactly', same(A.putCategory(r.categories, entry), menu()))
  check('twice does not duplicate the category or its items', same(A.putCategory(A.putCategory(r.categories, entry), entry), menu()))
  check('the id is never changed — happy hour and the waiter app key on it',
    A.putCategory(r.categories, entry).some((c) => c.id === 'cocktails'))

  // One cocktail was brought back on its own while the category was away.
  const solo = A.putItem(r.categories, {
    id: 'e3', kind: 'item', archivedAt: '2026-09-29T09:00:00.000Z', archivedBy: null,
    item: { uid: 'c9', he: 'ג׳ין טוניק', price: 48 },
    from: { categoryId: 'cocktails', icon: '🍹', title: { he: 'קוקטיילים' }, categoryIndex: 1, itemIndex: 0 },
  })
  const merged = A.putCategory(solo, entry)
  check('restoring the category merges into the one that is there now',
    merged.filter((c) => c.id === 'cocktails').length === 1 && names(merged, 'cocktails').length === 2)
  check('…keeping the item that was already back', names(merged, 'cocktails').includes('ג׳ין טוניק'))

  const clamped = A.putCategory([menu()[0]], { ...entry, categoryIndex: 7 })
  check('a position past the end appends', clamped.at(-1).id === 'cocktails')
}

// ── 6. reading the stored blob back ────────────────────────────────────
section('normalizeArchive — a hand-edited row never throws')
{
  check('null gives an empty list', A.normalizeArchive(null).length === 0)
  check('a non-object gives an empty list', A.normalizeArchive('boom').length === 0)
  check('entries that is not an array gives an empty list', A.normalizeArchive({ entries: 5 }).length === 0)

  const taken = A.takeItem(menu(), 'pizzas', { uid: 'p2' }, newUid)
  const good = entryFor(taken)
  const cat = A.takeCategory(menu(), 'cocktails')
  const goodCat = { id: 'e2', kind: 'category', archivedAt: '2026-09-30T10:00:00.000Z', archivedBy: null, category: cat.category, categoryIndex: 1 }

  const out = A.normalizeArchive({ entries: [
    good, goodCat,
    { id: 'bad1', kind: 'item' },
    { id: 'bad2', kind: 'mystery', archivedAt: '2026-09-29T10:00:00.000Z' },
    { id: 'bad3', kind: 'item', archivedAt: 'not a date', item: {}, from: {} },
    null, 7,
  ] })
  check('keeps the well-formed entries and drops the rest', out.length === 2)
  check('newest first', out[0].id === 'e2' && out[1].id === 'e1')
  check('a valid entry survives the round trip unchanged', same(out[1], good))

  const noItems = A.normalizeArchive({ entries: [{ ...goodCat, category: { id: 'x', title: { he: 'x' } } }] })
  check('a category without an items array is repaired to empty', noItems[0]?.category.items.length === 0)
}

section('names')
{
  const taken = A.takeItem(menu(), 'pizzas', { uid: 'p2' }, newUid)
  check('an item is named by its Hebrew name', A.entryName(entryFor(taken)) === 'פפרוני')
  check('falls back to English then Arabic', A.firstText({ en: 'Beer' }) === 'Beer' && A.firstText({ ar: 'بيرة' }) === 'بيرة')
  check('nothing at all is an empty string, never "undefined"', A.firstText(undefined) === '')
}

// ── report ─────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
