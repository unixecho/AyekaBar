#!/usr/bin/env node
// Route-level harness for POST/GET /api/owner/menu-86.
//
//   node scripts/check-menu-86.mjs
//
// check-archive.mjs proves the take-off / bring-back RULES. This proves the
// route that applies them to a live menu: that 86 hits the draft AND the
// published copy, leaves the rest of the draft alone, re-stamps `published_at`
// so open customer pages refetch, and — the part that matters most — that a
// failure between the two writes can never lose a dish.
//
// It runs the REAL src/app/api/owner/menu-86/route.ts. Only the edges are
// stubbed: `next/server`, the auth guard and the audit writer, plus an
// in-memory stand-in for the Supabase service client that can be told to fail
// a given write. Nothing here needs a database or a dev server.

import ts from 'typescript'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

const outDir = join(tmpdir(), `ayeka-menu86-check-${process.pid}`)
mkdirSync(outDir, { recursive: true })

const SRC = (p) => new URL(`../src/${p}`, import.meta.url)

// Every alias the route (and what it pulls in) uses, mapped to a flat file.
const ALIASES = {
  '@/lib/menu/types': './menu-types.mjs',
  '@/lib/menu/variants': './menu-variants.mjs',
  '@/lib/menu/archive': './archive.mjs',
  '@/lib/settings/keys': './keys.mjs',
  '@/lib/owner/guard': './stub-guard.mjs',
  '@/lib/owner/audit': './stub-audit.mjs',
  'next/server': './stub-next.mjs',
}

function emit(sourceUrl, outName, extra = (js) => js) {
  let js = ts.transpileModule(readFileSync(sourceUrl, 'utf8'), {
    fileName: outName.replace(/\.mjs$/, '.ts'),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText
  for (const [from, to] of Object.entries(ALIASES)) js = js.split(`'${from}'`).join(`'${to}'`)
  js = extra(js)
  writeFileSync(join(outDir, outName), js)
}
const menuRel = (js) => js
  .replace(/from '\.\/types'/g, "from './menu-types.mjs'")
  .replace(/from '\.\/variants'/g, "from './menu-variants.mjs'")

emit(SRC('lib/menu/types.ts'), 'menu-types.mjs', menuRel)
emit(SRC('lib/menu/variants.ts'), 'menu-variants.mjs', menuRel)
emit(SRC('lib/menu/archive.ts'), 'archive.mjs', menuRel)
emit(SRC('lib/settings/keys.ts'), 'keys.mjs')
emit(SRC('app/api/owner/menu-86/route.ts'), 'route.mjs')

writeFileSync(join(outDir, 'stub-next.mjs'), `
export class NextResponse { static json(body, init) { return { status: init?.status ?? 200, body } } }
export class NextRequest {}
`)
writeFileSync(join(outDir, 'stub-guard.mjs'), `
export async function requireMenuEditor() { return globalThis.__auth }
`)
writeFileSync(join(outDir, 'stub-audit.mjs'), `
export async function actorIdentity() { return { name: 'דנה', email: 'dana@example.com' } }
export async function logAudit(_s, _u, action, summary, detail) { globalThis.__audit.push({ action, summary, detail }) }
`)

const route = await import(pathToFileURL(join(outDir, 'route.mjs')).href)

// ── the fake database ──────────────────────────────────────────────────

function makeDb(seed) {
  const tables = {
    menus: [structuredClone(seed.menu)],
    app_settings: seed.entries ? [{ key: 'menu_86', value: { entries: structuredClone(seed.entries) }, is_public: false }] : [],
    menu_versions: [],
  }
  const writes = []                     // ordered log of every write, for ordering checks
  const failing = new Set()             // 'menus' | 'app_settings' — writes to these return an error

  function from(table) {
    let mode = 'select'
    let patch = null
    const filters = []
    const q = {
      select() { return q },
      eq(col, val) { filters.push([col, val]); return q },
      upsert(row) { mode = 'upsert'; patch = row; return q },
      update(p) { mode = 'update'; patch = p; return q },
      insert(row) { mode = 'insert'; patch = row; return q },
      single() { return Promise.resolve(read(true)) },
      maybeSingle() { return Promise.resolve(read(false)) },
      then(res, rej) { return Promise.resolve(write()).then(res, rej) },
    }
    const match = (row) => filters.every(([c, v]) => row[c] === v)
    function read(required) {
      const row = tables[table].find(match)
      if (!row) return required ? { data: null, error: { message: 'no rows' } } : { data: null, error: null }
      return { data: structuredClone(row), error: null }
    }
    function write() {
      if (failing.has(table)) return { data: null, error: { message: `injected failure on ${table}` } }
      writes.push(table)
      if (mode === 'update') {
        for (const row of tables[table].filter(match)) Object.assign(row, structuredClone(patch))
      } else if (mode === 'insert') {
        tables[table].push(structuredClone(patch))
      } else if (mode === 'upsert') {
        const at = tables[table].findIndex((r) => r.key === patch.key)
        if (at >= 0) tables[table][at] = structuredClone(patch)
        else tables[table].push(structuredClone(patch))
      }
      return { data: null, error: null }
    }
    return q
  }
  return { from, tables, writes, failing }
}

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n${t}`)
const same = (a, b) => isDeepStrictEqual(a, b)

const PUB_AT = '2026-09-01T08:00:00.000Z'

const baseCats = () => [
  { id: 'pizzas', icon: '🍕', title: { he: 'פיצות' }, items: [
    { uid: 'p1', he: 'מרגריטה', price: 52 },
    { uid: 'p2', he: 'פפרוני', price: 58 },
    { uid: 'p3', he: 'פטריות', price: 56 },
  ] },
  { id: 'cocktails', icon: '🍹', title: { he: 'קוקטיילים' }, items: [
    { uid: 'c1', he: 'מוחיטו', price: '52/208' },
  ] },
  { id: 'desserts', icon: '🍰', title: { he: 'קינוחים' }, items: [
    { he: 'טירמיסו', price: 38 },
  ] },
]

function setup({ entries, mutateDraft, mutatePublished } = {}) {
  const draft = { categories: baseCats() }
  const published = { categories: baseCats() }
  mutateDraft?.(draft.categories)
  mutatePublished?.(published.categories)
  const db = makeDb({ menu: { id: 'm1', slug: 'ayeka-bar', draft, published, published_at: PUB_AT }, entries })
  globalThis.__auth = { ok: true, service: { from: db.from }, userId: 'u1' }
  globalThis.__audit = []
  return db
}

const post = (body) => route.POST({ json: async () => body })
const names = (cats, id) => (cats.find((c) => c.id === id)?.items ?? []).map((i) => i.he)
const menuRow = (db) => db.tables.menus[0]
const list = (db) => db.tables.app_settings.find((r) => r.key === 'menu_86')?.value.entries ?? []

// ── 1. 86 an item ──────────────────────────────────────────────────────
section('86 an item — off the menu everywhere, at once')
{
  const db = setup({
    // An UNPUBLISHED edit elsewhere in the draft. 86 must not publish it.
    mutateDraft: (c) => { c[1].items[0].price = '60/240' },
  })
  const r = await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })

  check('answers 200', r.status === 200)
  check('gone from the draft', same(names(menuRow(db).draft.categories, 'pizzas'), ['מרגריטה', 'פטריות']))
  check('gone from the published copy — customers stop seeing it', same(names(menuRow(db).published.categories, 'pizzas'), ['מרגריטה', 'פטריות']))
  check('the response hands the editor the new draft', same(names(r.body.categories, 'pizzas'), ['מרגריטה', 'פטריות']))
  check('it is on the list, whole', list(db).length === 1 && list(db)[0].item.uid === 'p2' && list(db)[0].item.price === 58)
  check('the list records who did it', list(db)[0].archivedBy === 'דנה')
  check('the list is private', db.tables.app_settings[0].is_public === false)
  check('published_at is re-stamped, so open customer pages refetch', menuRow(db).published_at !== PUB_AT)
  check('a rollback point is recorded', db.tables.menu_versions.length === 1)
  check('an unrelated UNPUBLISHED draft edit stays a draft edit',
    menuRow(db).draft.categories[1].items[0].price === '60/240' && menuRow(db).published.categories[1].items[0].price === '52/208')
  check('it is audited', globalThis.__audit.length === 1 && globalThis.__audit[0].action === 'menu.archive' && globalThis.__audit[0].summary.includes('פפרוני'))
  check('the list is written BEFORE the menu — so a failure between them cannot lose the dish',
    db.writes.indexOf('app_settings') < db.writes.indexOf('menus'))
}

// ── 2. an item that was never published ────────────────────────────────
section('86 an item that was never live')
{
  const db = setup({
    mutateDraft: (c) => { c[0].items.push({ uid: 'p9', he: 'חדשה', price: 60 }) },
  })
  const r = await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p9' })
  check('works', r.status === 200 && list(db).length === 1)
  check('published copy untouched', same(menuRow(db).published.categories, baseCats()))
  check('…so published_at is NOT re-stamped (nothing changed for customers)', menuRow(db).published_at === PUB_AT)
  check('…and no rollback point is added', db.tables.menu_versions.length === 0)
}

// ── 3. legacy item, no uid ─────────────────────────────────────────────
section('86 an item that predates uids')
{
  const db = setup()
  const r = await post({ action: 'archive', kind: 'item', categoryId: 'desserts', index: 0 })
  check('taken by position', r.status === 200 && list(db)[0].item.he === 'טירמיסו')
  check('given a uid on the way in', typeof list(db)[0].item.uid === 'string' && list(db)[0].item.uid.length > 0)
  check('removed from the published copy too, by name and price', names(menuRow(db).published.categories, 'desserts').length === 0)
}

// ── 4. failures ────────────────────────────────────────────────────────
section('failures never lose a dish')
{
  // The list can't be written: nothing may have happened to the menu.
  const db = setup()
  db.failing.add('app_settings')
  const r = await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })
  check('list write fails → 500', r.status === 500)
  check('…and the menu is exactly as it was', same(menuRow(db).draft.categories, baseCats()) && same(menuRow(db).published.categories, baseCats()) && menuRow(db).published_at === PUB_AT)
}
{
  // The list is written but the menu can't be: dish is on the menu AND the list.
  const db = setup()
  db.failing.add('menus')
  const r = await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })
  check('menu write fails → 500', r.status === 500)
  check('…the dish is still on the menu', names(menuRow(db).draft.categories, 'pizzas').includes('פפרוני'))
  check('…and safe on the list (nothing is lost)', list(db).length === 1)

  db.failing.clear()
  const retry = await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })
  check('a retry succeeds', retry.status === 200)
  check('…and the list has ONE entry for the dish, not two', list(db).length === 1)
  check('…and it is now off the menu', !names(menuRow(db).published.categories, 'pizzas').includes('פפרוני'))
}
{
  const db = setup()
  const r = await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', index: 0 })
  check('a stale position (that item has a uid) is refused with 409', r.status === 409)
  check('…having written nothing at all', db.writes.length === 0)
}
{
  const db = setup()
  check('an unknown item is 404', (await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'zzz' })).status === 404)
  check('an unknown category is 404', (await post({ action: 'archive', kind: 'item', categoryId: 'zzz', uid: 'p1' })).status === 404)
  check('…with no writes', db.writes.length === 0)
}

// ── 5. bring it back ───────────────────────────────────────────────────
section('bring it back')
{
  const db = setup()
  await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })
  const id = list(db)[0].id

  // Wind the stamp back to a known value so "restore re-stamps it" is a real
  // assertion. Comparing against the stamp the 86 just wrote would race the
  // clock (two writes in the same millisecond) and prove nothing.
  const OLD_STAMP = '2026-01-01T00:00:00.000Z'
  menuRow(db).published_at = OLD_STAMP

  const r = await post({ action: 'restore', entryId: id })
  check('answers 200', r.status === 200)
  check('back in the draft, in its original slot', same(names(menuRow(db).draft.categories, 'pizzas'), ['מרגריטה', 'פפרוני', 'פטריות']))
  check('back in the published copy — customers see it again', same(names(menuRow(db).published.categories, 'pizzas'), ['מרגריטה', 'פפרוני', 'פטריות']))
  check('off the list', list(db).length === 0)
  check('published_at is re-stamped, so open customer pages see it come back', menuRow(db).published_at !== OLD_STAMP)
  check('the menu is byte-for-byte what it was before the 86', same(menuRow(db).draft.categories, baseCats()) && same(menuRow(db).published.categories, baseCats()))
  check('audited', globalThis.__audit.at(-1).action === 'menu.restore')
  check('the menu is written BEFORE the list is trimmed', db.writes.lastIndexOf('menus') < db.writes.lastIndexOf('app_settings'))

  check('bringing back something no longer on the list is 404 (a double tap)', (await post({ action: 'restore', entryId: id })).status === 404)
}
{
  const db = setup()
  await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })
  const id = list(db)[0].id
  db.failing.add('menus')
  const r = await post({ action: 'restore', entryId: id })
  check('menu write fails → 500', r.status === 500)
  check('…the entry is still on the list', list(db).length === 1)

  db.failing.clear()
  db.failing.add('app_settings')
  const partial = await post({ action: 'restore', entryId: id })
  check('the menu takes it back but the list trim fails → 500 with an honest message', partial.status === 500 && partial.body.error.includes('חזר לתפריט'))
  check('…it IS back on the menu', names(menuRow(db).published.categories, 'pizzas').includes('פפרוני'))

  db.failing.clear()
  const again = await post({ action: 'restore', entryId: id })
  check('pressing again is safe', again.status === 200)
  check('…the dish is on the menu exactly once', names(menuRow(db).draft.categories, 'pizzas').filter((n) => n === 'פפרוני').length === 1)
  check('…and off the list', list(db).length === 0)
}

// ── 6. categories ──────────────────────────────────────────────────────
section('86 a whole category')
{
  const db = setup()
  const r = await post({ action: 'archive', kind: 'category', categoryId: 'cocktails' })
  check('answers 200', r.status === 200)
  check('gone from both copies', !menuRow(db).draft.categories.some((c) => c.id === 'cocktails') && !menuRow(db).published.categories.some((c) => c.id === 'cocktails'))
  check('kept whole, items and all', list(db)[0].kind === 'category' && list(db)[0].category.items.length === 1)
  check('audited with the item count', globalThis.__audit[0].detail.items === 1)

  const back = await post({ action: 'restore', entryId: list(db)[0].id })
  check('comes back', back.status === 200 && same(menuRow(db).published.categories, baseCats()) && same(menuRow(db).draft.categories, baseCats()))
}

// ── 7. delete forever ──────────────────────────────────────────────────
section('delete forever')
{
  const db = setup()
  await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })
  const before = JSON.stringify(menuRow(db))
  const menuWrites = db.writes.filter((w) => w === 'menus').length
  const r = await post({ action: 'purge', entryId: list(db)[0].id })
  check('removes it from the list', r.status === 200 && list(db).length === 0 && r.body.entries.length === 0)
  check('touches the menu not at all', JSON.stringify(menuRow(db)) === before && db.writes.filter((w) => w === 'menus').length === menuWrites)
  check('audited', globalThis.__audit.at(-1).action === 'menu.purge')
  check('an unknown entry is 404', (await post({ action: 'purge', entryId: 'nope' })).status === 404)
}

// ── 8. limits, input, access ───────────────────────────────────────────
section('limits, bad input, access')
{
  const filler = Array.from({ length: 300 }, (_, i) => ({
    id: `f${i}`, kind: 'item', archivedAt: '2026-09-01T00:00:00.000Z', archivedBy: null,
    item: { uid: `old${i}`, he: `ישן ${i}` },
    from: { categoryId: 'pizzas', title: { he: 'פיצות' }, categoryIndex: 0, itemIndex: 0 },
  }))
  const db = setup({ entries: filler })
  const r = await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p1' })
  check('a full list refuses another entry with 409', r.status === 409)
  check('…and the dish stays on the menu', names(menuRow(db).published.categories, 'pizzas').includes('מרגריטה'))
  check('delete-forever still works on a full list, which is how you make room', (await post({ action: 'purge', entryId: 'f0' })).status === 200)
}
{
  setup()
  check('no action → 400', (await post({})).status === 400)
  check('unknown action → 400', (await post({ action: 'explode' })).status === 400)
  check('bad kind → 400', (await post({ action: 'archive', kind: 'menu', categoryId: 'pizzas' })).status === 400)
  check('missing category → 400', (await post({ action: 'archive', kind: 'item' })).status === 400)
  check('a non-object body → 400', (await route.POST({ json: async () => { throw new Error('bad json') } })).status === 400)
}
{
  setup()
  globalThis.__auth = { ok: false, res: { status: 403, body: { error: 'Forbidden' } } }
  check('POST without menu-editor access is passed through as refused', (await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p1' })).status === 403)
  check('GET too', (await route.GET()).status === 403)
}
{
  const db = setup()
  await post({ action: 'archive', kind: 'item', categoryId: 'pizzas', uid: 'p2' })
  const g = await route.GET()
  check('GET returns the list', g.status === 200 && g.body.entries.length === 1 && g.body.entries[0].item.he === 'פפרוני')
}

// ── report ─────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILED:')
  for (const f of failures) console.log(`  · ${f}`)
  process.exit(1)
}
