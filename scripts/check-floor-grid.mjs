#!/usr/bin/env node
// Logic harness for the portal's copy of the magnet grid.
//
//   node --experimental-strip-types scripts/check-floor-grid.mjs
//
// WHY THIS EXISTS SEPARATELY from ayeka-staff/scripts/check-grid.mjs: the two
// apps live in separate repos with no shared package, so src/lib/waiter/grid.ts
// is a hand-kept copy. Both place objects on the SAME rows in the SAME
// database — if the builder snaps differently from the waiter map, layouts
// jump the moment the other app opens them. This harness's job is to catch the
// copies drifting.
//
// The last block is the important one: it asserts the CONSTANTS that form the
// contract between the two files, not just that the maths is self-consistent.

import * as G from '../src/lib/waiter/grid.ts'

let pass = 0
const fails = []
const ok = (name, cond) => (cond ? pass++ : fails.push(name))
const eq = (name, a, b) =>
  ok(`${name} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`,
     JSON.stringify(a) === JSON.stringify(b))

// The real production canvas.
const canvas = { w: 560, h: 720, configured: true }
const { pw, ph } = G.cellSize(canvas)

/* ── Rotation ─────────────────────────────────────────────────────── */
eq('1x1 is rotation-invariant', G.effSpan({ grid_w: 1, grid_h: 1, rotation: 90 }), { w: 1, h: 1 })
eq('2x1 at 0 stays wide', G.effSpan({ grid_w: 2, grid_h: 1, rotation: 0 }), { w: 2, h: 1 })
eq('2x1 at 90 turns tall', G.effSpan({ grid_w: 2, grid_h: 1, rotation: 90 }), { w: 1, h: 2 })
eq('2x1 at 180 is wide again', G.effSpan({ grid_w: 2, grid_h: 1, rotation: 180 }), { w: 2, h: 1 })
eq('negative rotation normalises', G.effSpan({ grid_w: 2, grid_h: 1, rotation: -90 }), { w: 1, h: 2 })

/* ── Centre ↔ anchor round-trips ──────────────────────────────────── */
for (const span of [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }, { w: 3, h: 1 }]) {
  const c = G.centerOf(1, 2, span, canvas)
  eq(`round-trip ${span.w}x${span.h}`, G.anchorOf(c.x, c.y, span, canvas), { c: 1, r: 2 })
}

/* ── Occupancy expands to EVERY covered cell ──────────────────────── */
const big = { ...G.centerOf(0, 0, { w: 2, h: 2 }, canvas), grid_w: 2, grid_h: 2, rotation: 0 }
const occ = G.occupancySet([{ pos_x: big.x, pos_y: big.y, grid_w: 2, grid_h: 2, rotation: 0 }], canvas)
eq('a 2x2 occupies four cells', occ.size, 4)
ok('including its far corner', occ.has('1:1'))

/* ── fits() tests the WHOLE footprint ─────────────────────────────── */
ok('a free 2x2 fits', G.fits(2, 2, { w: 2, h: 2 }, canvas, new Set()))
ok('a 2x2 overlapping one taken cell does not', !G.fits(0, 0, { w: 2, h: 2 }, canvas, new Set(['1:1'])))
ok('negative anchors are out of bounds', !G.fits(-1, 0, { w: 1, h: 1 }, canvas, new Set()))
const { cols, rows } = G.gridDims(canvas)
ok('a footprint running off the right edge does not fit',
   !G.fits(cols - 1, 0, { w: 2, h: 1 }, canvas, new Set()))
ok('a footprint running off the bottom does not fit',
   !G.fits(0, rows - 1, { w: 1, h: 2 }, canvas, new Set()))

/* ── The ring search finds the nearest free ANCHOR ────────────────── */
// A 2x2 dropped straight onto an occupied cell must deflect clear, not
// overlap — the exact regression a naive single-cell grid produces.
const blocker = { pos_x: G.centerOf(1, 1, { w: 1, h: 1 }, canvas).x,
                  pos_y: G.centerOf(1, 1, { w: 1, h: 1 }, canvas).y,
                  grid_w: 1, grid_h: 1, rotation: 0 }
const target = G.centerOf(0, 0, { w: 2, h: 2 }, canvas)
const landed = G.snapToGrid(target.x, target.y, { grid_w: 2, grid_h: 2, rotation: 0 }, canvas, [blocker])
const landedAnchor = G.anchorOf(landed.x, landed.y, { w: 2, h: 2 }, canvas)
const landedCells = G.cellsOf(landedAnchor.c, landedAnchor.r, { w: 2, h: 2 })
ok('a 2x2 dropped on an occupied cell deflects clear', !landedCells.includes('1:1'))
ok('and stays inside the canvas', landedAnchor.c >= 0 && landedAnchor.r >= 0)

// An empty floor must not move a drop that was already on a valid anchor.
const clean = G.centerOf(2, 3, { w: 1, h: 1 }, canvas)
const snapped = G.snapToGrid(clean.x, clean.y, { grid_w: 1, grid_h: 1, rotation: 0 }, canvas, [])
eq('an unobstructed drop lands where it was aimed',
   G.anchorOf(snapped.x, snapped.y, { w: 1, h: 1 }, canvas), { c: 2, r: 3 })

// A drop outside the canvas is pulled back inside.
const outside = G.snapToGrid(-40, 140, { grid_w: 1, grid_h: 1, rotation: 0 }, canvas, [])
ok('an out-of-bounds drop is clamped inside',
   outside.x >= 0 && outside.x <= 100 && outside.y >= 0 && outside.y <= 100)

/* ── isPlaced ─────────────────────────────────────────────────────── */
ok('an unplaced object is detected', !G.isPlaced({ pos_x: null, pos_y: null }))
ok('a placed one at the origin still counts', G.isPlaced({ pos_x: 0, pos_y: 0 }))

/* ── hasRoomFor: the auto-grow trigger ────────────────────────────── */
ok('an empty canvas has room for a 2x2', G.hasRoomFor({ grid_w: 2, grid_h: 2, rotation: 0 }, canvas, []))
{
  // Pack every cell of a small canvas with 1x1s, leaving none free.
  const tiny = { w: G.MAGNET.w * 2, h: G.MAGNET.h * 2, configured: true }
  const { cols: tc, rows: tr } = G.gridDims(tiny)
  const full = []
  for (let c = 0; c < tc; c++)
    for (let r = 0; r < tr; r++) {
      const center = G.centerOf(c, r, { w: 1, h: 1 }, tiny)
      full.push({ pos_x: center.x, pos_y: center.y, grid_w: 1, grid_h: 1, rotation: 0 })
    }
  ok('a fully packed canvas has no room left', !G.hasRoomFor({ grid_w: 1, grid_h: 1, rotation: 0 }, tiny, full))
  ok('growing that canvas by one row makes room again',
     G.hasRoomFor({ grid_w: 1, grid_h: 1, rotation: 0 }, { ...tiny, h: tiny.h + G.MAGNET.h }, full))
}

/* ── growHeightToFit: the auto-grow amount, reasoned in cell space ─── */
{
  const tiny = { w: G.MAGNET.w * 2, h: G.MAGNET.h * 2, configured: true }
  const { cols: tc, rows: tr } = G.gridDims(tiny)
  const full = []
  for (let c = 0; c < tc; c++)
    for (let r = 0; r < tr; r++) {
      const center = G.centerOf(c, r, { w: 1, h: 1 }, tiny)
      full.push({ pos_x: center.x, pos_y: center.y, grid_w: 1, grid_h: 1, rotation: 0 })
    }
  const grownCanvas = G.growHeightToFit({ grid_w: 1, grid_h: 1, rotation: 0 }, tiny, full)
  eq('growHeightToFit adds exactly one row to a packed 2x2',
     grownCanvas, { ...tiny, h: tiny.h + G.MAGNET.h })
  ok('an already-roomy canvas is returned unchanged',
     G.growHeightToFit({ grid_w: 1, grid_h: 1, rotation: 0 }, canvas, []).h === canvas.h)
}

/* ── reanchorAll: growing the room must not drift existing furniture ─ */
{
  const center = G.centerOf(2, 3, { w: 1, h: 1 }, canvas)
  const obj = { pos_x: center.x, pos_y: center.y, grid_w: 1, grid_h: 1, rotation: 0 }
  const grown = { ...canvas, h: canvas.h + G.MAGNET.h }
  const [reanchored] = G.reanchorAll([obj], canvas, grown)
  eq('reanchored object keeps the same anchor cell after growth',
     G.anchorOf(reanchored.pos_x, reanchored.pos_y, { w: 1, h: 1 }, grown), { c: 2, r: 3 })
  ok('an unplaced object passes through reanchorAll untouched',
     G.reanchorAll([{ pos_x: null, pos_y: null, grid_w: 1, grid_h: 1, rotation: 0 }], canvas, grown)[0].pos_x === null)
}

/* ── THE CONTRACT WITH ayeka-staff/src/grid.ts ────────────────────── */
// These are the values that must not drift between the two copies. A change
// here silently moves every existing layout the other app reads.
eq('MAGNET cell is 84x66', G.MAGNET, { w: 84, h: 66 })
eq('production canvas yields 6 columns', cols, 6)
eq('production canvas yields 10 rows', rows, 10)
ok('cell width in percent is stable', Math.abs(pw - 15) < 1e-9)
ok('cell height in percent is stable', Math.abs(ph - (66 / 720) * 100) < 1e-9)

const total = pass + fails.length
for (const f of fails) console.error(`  ✗ ${f}`)
console.log(`${pass}/${total} floor-grid checks passed`)
process.exit(fails.length ? 1 : 0)
