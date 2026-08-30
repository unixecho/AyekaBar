// The magnet grid, generalised to footprints. PURE — no imports, no env, no
// network — so scripts/check-floor-grid.mjs can exercise it under plain Node.
//
// ⚠️ TWIN FILE. This is a verbatim port of `ayeka-staff/src/grid.ts`. The two
// apps live in separate repos with no shared package, and both have to place
// objects on the SAME rows in the SAME database — a builder that snaps
// differently from the waiter map would produce layouts that jump when the
// other app opens them. Keep them identical; both are exercised by their own
// harness, and the constants below (MAGNET especially) are the contract.
//
// Positions are percentages of the canvas; pos_x/pos_y are the CENTRE of an
// object's footprint, which is exactly what the pre-footprint schema stored
// for its 1×1 tables, so existing positions stay valid without migration.
//
// The original grid assumed every table occupies exactly one cell: occupancy
// was a Set of single "col:row" strings and fits() tested one point. With
// grid_w×grid_h footprints (a family table is 2×2, a wall prop is 4×1) that
// assumption is a bug — a naive version lets big tables silently overlap. Now:
//   • occupancy expands every object to ALL the cells it covers;
//   • fits() tests a candidate anchor against the whole footprint, bounds
//     included;
//   • the ring search hunts for the nearest free ANCHOR, which for a 2×2 is
//     not the nearest free cell.

export interface Placeable {
  pos_x: number | null
  pos_y: number | null
  grid_w: number
  grid_h: number
  rotation: number
}

export interface Canvas {
  w: number
  h: number
  configured: boolean
}

export type Span = { w: number; h: number }

export const MAGNET = { w: 84, h: 66 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const EPS = 1e-6

export const isPlaced = (t: { pos_x: number | null; pos_y: number | null }) =>
  t.pos_x !== null && t.pos_y !== null

/** Effective span after rotation: 90°/270° swap width and height. */
export function effSpan(p: Pick<Placeable, 'grid_w' | 'grid_h' | 'rotation'>): Span {
  const rot = ((p.rotation % 360) + 360) % 360
  return rot % 180 === 90 ? { w: p.grid_h, h: p.grid_w } : { w: p.grid_w, h: p.grid_h }
}

/** Cell size in canvas percent. */
export const cellSize = (canvas: Canvas) => ({
  pw: (MAGNET.w / canvas.w) * 100,
  ph: (MAGNET.h / canvas.h) * 100,
})

/** Anchor (top-left cell) of a footprint whose CENTRE is at (px,py) percent. */
export function anchorOf(px: number, py: number, span: Span, canvas: Canvas): { c: number; r: number } {
  const { pw, ph } = cellSize(canvas)
  return {
    c: Math.round(px / pw - span.w / 2),
    r: Math.round(py / ph - span.h / 2),
  }
}

/** Centre (percent) of a footprint anchored at cell (c,r). */
export function centerOf(c: number, r: number, span: Span, canvas: Canvas): { x: number; y: number } {
  const { pw, ph } = cellSize(canvas)
  return { x: (c + span.w / 2) * pw, y: (r + span.h / 2) * ph }
}

/** Every cell a footprint covers, as "c:r" keys. */
export function cellsOf(c: number, r: number, span: Span): string[] {
  const out: string[] = []
  for (let i = 0; i < span.w; i++)
    for (let j = 0; j < span.h; j++) out.push(`${c + i}:${r + j}`)
  return out
}

/** The cells taken by every placed object — the thing fits() tests against. */
export function occupancySet(objects: Placeable[], canvas: Canvas): Set<string> {
  const occ = new Set<string>()
  for (const o of objects) {
    if (!isPlaced(o)) continue
    const span = effSpan(o)
    const { c, r } = anchorOf(o.pos_x!, o.pos_y!, span, canvas)
    for (const key of cellsOf(c, r, span)) occ.add(key)
  }
  return occ
}

/** Whole-footprint test: inside the canvas AND every cell free. */
export function fits(
  c: number, r: number, span: Span, canvas: Canvas, occupied: Set<string>
): boolean {
  if (c < 0 || r < 0) return false
  const { pw, ph } = cellSize(canvas)
  if ((c + span.w) * pw > 100 + EPS || (r + span.h) * ph > 100 + EPS) return false
  return cellsOf(c, r, span).every((key) => !occupied.has(key))
}

/**
 * Drop (x,y) and snap: nearest free anchor for this object's footprint,
 * searching outward ring by ring. `others` are all OTHER placed objects on
 * the same floor — tables and props alike — which the footprint must not
 * overlap.
 */
export function snapToGrid(
  x: number,
  y: number,
  moving: Pick<Placeable, 'grid_w' | 'grid_h' | 'rotation'>,
  canvas: Canvas,
  others: Placeable[]
): { x: number; y: number } {
  const span = effSpan(moving)
  const { pw, ph } = cellSize(canvas)
  const occupied = occupancySet(others, canvas)

  const half = { x: (span.w * pw) / 2, y: (span.h * ph) / 2 }
  const cx = clamp(x, half.x, 100 - half.x)
  const cy = clamp(y, half.y, 100 - half.y)
  const { c: c0, r: r0 } = anchorOf(cx, cy, span, canvas)

  for (let ring = 0; ring < 24; ring++) {
    let best: { c: number; r: number; d: number } | null = null
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue
        const c = c0 + dc, r = r0 + dr
        if (!fits(c, r, span, canvas, occupied)) continue
        const ctr = centerOf(c, r, span, canvas)
        const d = Math.hypot(ctr.x - x, ctr.y - y)
        if (!best || d < best.d) best = { c, r, d }
      }
    }
    if (best) return centerOf(best.c, best.r, span, canvas)
  }
  // Floor genuinely full — leave it where it landed.
  return { x: clamp(x, 2, 98), y: clamp(y, 2, 98) }
}

/** Grid dimensions, for drawing the guides a builder needs to aim at. */
export function gridDims(canvas: Canvas): { cols: number; rows: number } {
  const { pw, ph } = cellSize(canvas)
  return { cols: Math.floor((100 + EPS) / pw), rows: Math.floor((100 + EPS) / ph) }
}

/**
 * Whether this footprint has anywhere at all to land in the current canvas —
 * i.e., whether snapToGrid would find a real anchor rather than falling
 * through to its last-resort "leave it where it landed" clamp. Scans every
 * anchor rather than ring-searching outward: this only runs when a caller is
 * deciding whether the room needs to grow, not on every drag frame, so
 * exhaustive is fine and a lot simpler to trust than reasoning about how far
 * a ring search reaches from an arbitrary starting point.
 */
export function hasRoomFor(
  moving: Pick<Placeable, 'grid_w' | 'grid_h' | 'rotation'>,
  canvas: Canvas,
  others: Placeable[]
): boolean {
  const span = effSpan(moving)
  const { cols, rows } = gridDims(canvas)
  const occupied = occupancySet(others, canvas)
  for (let r = 0; r <= rows - span.h; r++) {
    for (let c = 0; c <= cols - span.w; c++) {
      if (fits(c, r, span, canvas, occupied)) return true
    }
  }
  return false
}

/**
 * Recompute every placed object's percentage position for a NEW canvas size,
 * preserving its ANCHOR CELL rather than its raw percentage. A percentage
 * only means something relative to one canvas size — resizing the canvas
 * without this would silently slide every existing table by however much the
 * resize distorted the grid, which reads as furniture drifting for no reason
 * the owner did. Used when a builder grows or shrinks the room: reanchor
 * everything already on the map first, onto the SAME cells, then whatever
 * triggered the resize gets its own fresh snap against the result.
 */
export function reanchorAll<T extends Placeable>(
  objects: T[], oldCanvas: Canvas, newCanvas: Canvas
): T[] {
  return objects.map((o) => {
    if (!isPlaced(o)) return o
    const span = effSpan(o)
    const { c, r } = anchorOf(o.pos_x!, o.pos_y!, span, oldCanvas)
    const center = centerOf(c, r, span, newCanvas)
    return { ...o, pos_x: center.x, pos_y: center.y }
  })
}

/**
 * The smallest height (canvas.h grown by whole MAGNET rows) that gives
 * `moving` somewhere to land, given every OTHER object's CURRENT placement.
 * Reasons in CELL space against the canvas passed in, computed once — an
 * object's anchor cell does not move just because the canvas is about to
 * grow, so occupancy must not be re-derived from raw percentages at each
 * candidate height. Doing that would reinterpret a percentage that has not
 * caught up with the new size yet, and answer a question about the wrong
 * cells entirely (the same bug reanchorAll above exists to fix on the write
 * side). Only grows height: a column anchor depends on width alone, so a
 * caller that only ever adds rows never has to reason about width drift.
 */
export function growHeightToFit(
  moving: Pick<Placeable, 'grid_w' | 'grid_h' | 'rotation'>,
  canvas: Canvas,
  others: Placeable[],
  maxSteps = 30
): Canvas {
  // Every OTHER object's cell, fixed once against the canvas passed in —
  // this is the stable fact that must survive however many rows get added.
  const otherCells = others.filter(isPlaced).map((o) => {
    const oSpan = effSpan(o)
    const { c, r } = anchorOf(o.pos_x!, o.pos_y!, oSpan, canvas)
    return { c, r, span: oSpan }
  })
  const occupied = new Set<string>()
  for (const o of otherCells) for (const key of cellsOf(o.c, o.r, o.span)) occupied.add(key)

  const span = effSpan(moving)
  let grown = canvas
  for (let i = 0; i < maxSteps; i++) {
    const { cols, rows } = gridDims(grown)
    for (let r = 0; r <= rows - span.h; r++) {
      for (let c = 0; c <= cols - span.w; c++) {
        if (fits(c, r, span, grown, occupied)) return grown
      }
    }
    grown = { ...grown, h: grown.h + MAGNET.h }
  }
  return grown
}
