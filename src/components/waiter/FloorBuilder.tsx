'use client'

// The floor builder — where a room gets drawn once and then adjusted forever.
//
// The waiter app READS this layout to work a shift. This is the other half:
// the owner or a manager sits down once, lays out the real room, and comes
// back whenever it changes — a booth pulled out for a party, two tables
// joined, the outside section opened for summer.
//
// ── Four things that decide how this behaves ─────────────────────────
//
// 1. THE CANVAS IS ALWAYS dir="ltr". It represents physical space. A room does
//    not mirror because the UI is Hebrew, and positions are stored as
//    percentages from the left — so an RTL canvas would silently flip every
//    layout the waiter app then reads back.
//
// 2. DRAGGING SHOWS YOU THE TRUTH TWICE. The object follows the pointer
//    unsnapped, and a dashed outline shows where it will actually land. Snap
//    happens on release. Showing only the snapped position makes the grid feel
//    like it is fighting you; showing only the free position hides the result.
//
// 3. STRUCTURE SAVES ITSELF, GEOMETRY DOES NOT. Adding a table, deleting one,
//    setting Owners/VIP — discrete decisions, written immediately. Positions
//    and sizes batch into an explicit Save, because arranging fifteen tables
//    is one act, not fifteen.
//
// 4. THE DATABASE IS THE GATE. This runs on the manager's own session, so
//    `is_floor_manager()` (migration 022) decides. `canManage` only hides
//    controls the server would refuse — every refusal is still reported.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addFloor, addProp, addTable, canvasOf, deactivateTable, defaultPropSpan, isLandmark,
  loadFloorPlan, onFloor, PROP_LANDMARKS, PROP_OBSTACLES, reactivateTable, removeProp,
  saveFloorLayout, setTableLabelKind, suggestNumber, tableName, UNIQUE_VIOLATION,
  type Floor, type FloorPlan, type FloorProp, type FloorTable,
  type LabelKind, type PropKind, type TableKind, type TableShape,
} from '@/lib/waiter/floor'
import {
  anchorOf, cellSize, effSpan, gridDims, growHeightToFit, isPlaced, MAGNET,
  reanchorAll, snapToGrid, type Canvas, type Placeable,
} from '@/lib/waiter/grid'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { haptic } from '@/lib/haptics'
import './floor-builder.css'

const KIND_HE: Record<TableKind, string> = {
  regular: 'רגיל', large: 'גדול', tall: 'גבוה', booth: 'תא עץ', bar: 'בר',
}
const PROP_HE: Record<PropKind, string> = {
  entrance: 'כניסה', kitchen: 'מטבח', wc: 'שירותים', bar: 'בר', register: 'קופה',
  hostess: 'עמדת מארחת', wall: 'קיר', divider: 'מחיצה', plant: 'צמח',
  spacer: 'מעבר', station: 'עמדת שירות', custom: 'אחר',
}
const PROP_GLYPH: Partial<Record<PropKind, string>> = {
  entrance: '⇥', kitchen: '⌂', wc: '⚦', bar: '⊓', register: '▤',
}

// Room size bounds, in whole MAGNET cells per axis — shared by the manual
// resize stepper and the ceiling auto-grow refuses to sail past.
const MIN_ROOM_CELLS = 2
const MAX_ROOM_CELLS = 24

type Sel = { kind: 'table'; id: string } | { kind: 'prop'; id: string } | null

interface DragState {
  kind: 'table' | 'prop'
  id: string
  /** Live, UNSNAPPED centre in canvas percent. */
  x: number
  y: number
  /** Pointer→centre offset at grab time, so the object does not jump. */
  dx: number
  dy: number
  moved: boolean
}

export default function FloorBuilder({ canManage }: { canManage: boolean }) {
  const [plan, setPlan] = useState<FloorPlan | null>(null)
  const [floorId, setFloorId] = useState<string | null>(null)
  const [sel, setSel] = useState<Sel>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [dirty, setDirty] = useState(false)
  // A local override once the room has been resized (manually, or auto-grown
  // to fit a table) — same "batched into Save" posture as position/size.
  // `floor.canvas_w/h` stays untouched until Save persists this. Cleared on
  // a floor switch (a different floor has its own size) and folded back into
  // `plan` after a successful Save, so nothing keeps two disagreeing ideas
  // of "the current canvas" once the database agrees.
  const [canvasOverride, setCanvasOverride] = useState<Canvas | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const [promptReq, setPromptReq] = useState<PromptRequest | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const flash = useCallback((text: string, bad = false) => {
    setMsg({ text, bad })
    window.setTimeout(() => setMsg(null), 3200)
  }, [])

  useEffect(() => {
    void loadFloorPlan().then((p) => {
      setPlan(p)
      setFloorId((cur) => cur ?? p.floors[0]?.id ?? null)
    })
  }, [])

  const floor: Floor | undefined = plan?.floors.find((f) => f.id === floorId)
  const canvas: Canvas = canvasOverride ?? canvasOf(floor)
  const scoped = plan && floorId ? onFloor(plan, floorId) : { tables: [], props: [] }
  const placedTables = scoped.tables.filter(isPlaced)
  const unplaced = scoped.tables.filter((t) => !isPlaced(t))
  const objects = [...placedTables, ...scoped.props.filter(isPlaced)]

  const selected = useMemo(() => {
    if (!sel || !plan) return null
    return sel.kind === 'table'
      ? plan.tables.find((t) => t.id === sel.id) ?? null
      : plan.props.find((p) => p.id === sel.id) ?? null
  }, [sel, plan])

  /* ── Local edits (batched into Save) ──────────────────────────────── */

  const patchTable = (id: string, patch: Partial<FloorTable>) => {
    setPlan((p) => p && { ...p, tables: p.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
    setDirty(true)
  }
  const patchProp = (id: string, patch: Partial<FloorProp>) => {
    setPlan((p) => p && { ...p, props: p.props.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
    setDirty(true)
  }

  /** Grow the room by whole rows when there is nowhere left for `moving` to
   *  land, then snap it in. Growing reanchors every OTHER object already on
   *  this floor onto the taller canvas FIRST — same cell, recomputed
   *  percentage (see grid.ts's reanchorAll) — so nothing already placed
   *  silently drifts just because the room got taller. `excludeId` is the
   *  object being placed/moved/resized itself, which must never count as
   *  its own obstacle. */
  const snapWithGrowth = (
    x: number, y: number,
    moving: Pick<Placeable, 'grid_w' | 'grid_h' | 'rotation'>,
    excludeId: string
  ): { x: number; y: number } => {
    const others = objects.filter((o) => o.id !== excludeId)
    // Capped at the same ceiling the manual stepper respects — auto-grow is
    // the emergency door, not a way to sail past a limit the owner would
    // otherwise be stopped at.
    const room = Math.max(0, MAX_ROOM_CELLS - gridDims(canvas).rows)
    const grown = growHeightToFit(moving, canvas, others, room)
    if (grown.h === canvas.h) return snapToGrid(x, y, moving, canvas, others)

    const reTables = reanchorAll(scoped.tables, canvas, grown)
    const reProps = reanchorAll(scoped.props, canvas, grown)
    setPlan((p) => p && {
      ...p,
      tables: p.tables.map((t) => reTables.find((r) => r.id === t.id) ?? t),
      props: p.props.map((x2) => reProps.find((r) => r.id === x2.id) ?? x2),
    })
    setCanvasOverride(grown)
    setDirty(true)
    flash('החדר הורחב כדי לפנות מקום')

    const grownOthers = [...reTables, ...reProps].filter(isPlaced).filter((o) => o.id !== excludeId)
    return snapToGrid(x, y, moving, grown, grownOthers)
  }

  /** Re-snap after a resize or rotation: a table that grew must not be left
   *  overlapping a neighbour it used to clear. */
  const reshape = (id: string, kind: 'table' | 'prop', patch: { grid_w?: number; grid_h?: number; rotation?: number }) => {
    const obj = kind === 'table'
      ? plan?.tables.find((t) => t.id === id)
      : plan?.props.find((p) => p.id === id)
    if (!obj) return
    const next = { ...obj, ...patch }
    if (isPlaced(next)) {
      const spot = snapWithGrowth(next.pos_x!, next.pos_y!, next, id)
      Object.assign(next, { pos_x: spot.x, pos_y: spot.y })
    }
    if (kind === 'table') patchTable(id, next as Partial<FloorTable>)
    else patchProp(id, next as Partial<FloorProp>)
  }

  /* ── Dragging ─────────────────────────────────────────────────────── */

  const pctFrom = (clientX: number, clientY: number) => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return { x: ((clientX - r.left) / r.width) * 100, y: ((clientY - r.top) / r.height) * 100 }
  }

  function onObjectDown(e: React.PointerEvent, kind: 'table' | 'prop', obj: FloorTable | FloorProp) {
    if (!canManage) return
    e.preventDefault()
    e.stopPropagation()
    setSel({ kind, id: obj.id } as Sel)
    if (!isPlaced(obj)) return
    const p = pctFrom(e.clientX, e.clientY)
    // Capture is an optimisation — it keeps the drag alive when the pointer
    // outruns the element — NOT a precondition. It throws for a pointer the
    // browser no longer considers active, and having it above setDrag meant
    // one throw killed the entire gesture with no error surfaced anywhere.
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    setDrag({
      kind, id: obj.id,
      x: obj.pos_x!, y: obj.pos_y!,
      dx: obj.pos_x! - p.x, dy: obj.pos_y! - p.y,
      moved: false,
    })
  }

  function onObjectMove(e: React.PointerEvent) {
    if (!drag) return
    const p = pctFrom(e.clientX, e.clientY)
    setDrag({ ...drag, x: p.x + drag.dx, y: p.y + drag.dy, moved: true })
  }

  // A11y (WCAG 2.2 2.5.7 Dragging Movements — tracked as A17). The table/prop
  // divs below carry NO other way to move than the pointer handlers above —
  // confirmed drag-only, no keyboard/single-pointer alternative anywhere in
  // this file. This is that alternative: arrow keys nudge the focused object
  // one grid cell at a time, running through snapWithGrowth — the SAME
  // collision-aware, room-growing function the mouse path already calls on
  // release (onObjectUp below) — so a keyboard move can never overlap a
  // neighbour or fall outside the room any more than a mouse move can.
  function onObjectKeyDown(e: React.KeyboardEvent, kind: 'table' | 'prop', obj: FloorTable | FloorProp) {
    if (!canManage || !isPlaced(obj)) return
    const STEP: Partial<Record<string, [number, number]>> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const delta = STEP[e.key]
    if (!delta) return
    e.preventDefault()
    const c = cellSize(canvas)
    const spot = snapWithGrowth(obj.pos_x! + delta[0] * c.pw, obj.pos_y! + delta[1] * c.ph, obj, obj.id)
    haptic('tick')
    if (kind === 'table') patchTable(obj.id, { pos_x: spot.x, pos_y: spot.y })
    else patchProp(obj.id, { pos_x: spot.x, pos_y: spot.y })
  }

  function onObjectUp(e: React.PointerEvent) {
    if (!drag) return
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* gone */ }
    if (drag.moved) {
      const obj = drag.kind === 'table'
        ? plan?.tables.find((t) => t.id === drag.id)
        : plan?.props.find((x) => x.id === drag.id)
      if (obj) {
        const spot = snapWithGrowth(drag.x, drag.y, obj, drag.id)
        if (drag.kind === 'table') patchTable(drag.id, { pos_x: spot.x, pos_y: spot.y })
        else patchProp(drag.id, { pos_x: spot.x, pos_y: spot.y })
      }
    }
    setDrag(null)
  }

  /** Where the thing being dragged will actually land. */
  const dropPreview = useMemo(() => {
    if (!drag) return null
    const obj = drag.kind === 'table'
      ? plan?.tables.find((t) => t.id === drag.id)
      : plan?.props.find((x) => x.id === drag.id)
    if (!obj) return null
    const others = objects.filter((o) => o.id !== drag.id)
    const spot = snapToGrid(drag.x, drag.y, obj, canvas, others)
    const span = effSpan(obj)
    const cell = cellSize(canvas)
    return { x: spot.x, y: spot.y, w: span.w * cell.pw, h: span.h * cell.ph }
  }, [drag, plan, objects, canvas])

  /** Drop an unplaced table onto the middle of the room and let the magnet
   *  find the nearest free anchor. */
  function placeOnMap(t: FloorTable) {
    const spot = snapWithGrowth(50, 50, t, t.id)
    patchTable(t.id, { pos_x: spot.x, pos_y: spot.y })
    setSel({ kind: 'table', id: t.id })
  }

  /* ── Structural writes (immediate) ────────────────────────────────── */

  async function onAddTable() {
    if (!floorId || !plan) return
    setBusy(true)

    // `suggestNumber` only sees ACTIVE tables (loadFloorPlan filters on
    // active=true), but `waiter_tables.number` is unique across every row —
    // active or deactivated. A number "freed" by deleting a table is not
    // actually free at the database level, so the first guess can collide.
    // Retry forward past every number the database actually rejects, rather
    // than surfacing that as a dead end — the visible symptom this fixes was
    // "duplicate key value violates … waiter_tables_number_key" on every
    // attempt to add a table after clearing an old layout.
    const blocked = new Set(plan.tables.map((t) => t.number))
    let row: FloorTable | null = null
    let lastError: string | null = null
    for (let attempt = 0; attempt < 50; attempt++) {
      const number = suggestNumber(Array.from(blocked, (n) => ({ number: n })))
      const result = await addTable({ number, floor_id: floorId })
      if (result.row) { row = result.row; break }
      if (result.code === UNIQUE_VIOLATION) { blocked.add(number); continue }
      lastError = result.error
      break
    }

    setBusy(false)
    if (!row) { flash(lastError ?? 'לא ניתן להוסיף שולחן', true); return }
    setPlan((p) => p && { ...p, tables: [...p.tables, row!] })
    setSel({ kind: 'table', id: row.id })
    flash(`שולחן ${row.number} נוסף — גררו אותו למקום`)
  }

  async function onAddProp(kind: PropKind) {
    if (!floorId) return
    setBusy(true)
    // The real footprint is knowable up front (defaultPropSpan is the same
    // pure function the server falls back to) — snapping once with it,
    // rather than guessing 1×1 and re-snapping after the round trip, is both
    // simpler and lets snapWithGrowth grow the room BEFORE the write instead
    // of after, when a second grow decision would be reasoning about a
    // canvas that may already be stale.
    const span = defaultPropSpan(kind)
    const spot = snapWithGrowth(50, 50, { grid_w: span.grid_w, grid_h: span.grid_h, rotation: 0 }, '')
    const { row, error } = await addProp({
      floor_id: floorId, kind, pos_x: spot.x, pos_y: spot.y,
      grid_w: span.grid_w, grid_h: span.grid_h,
    })
    setBusy(false)
    if (error || !row) { flash(error ?? 'לא ניתן להוסיף', true); return }
    setPlan((p) => p && { ...p, props: [...p.props, row] })
    setSel({ kind: 'prop', id: row.id })
    setDirty(true)
  }

  async function onDeleteSelected() {
    if (!sel || !selected) return
    setBusy(true)
    const err = sel.kind === 'table' ? await deactivateTable(sel.id) : await removeProp(sel.id)
    setBusy(false)
    if (err) { flash(err, true); return }
    setPlan((p) => {
      if (!p) return p
      if (sel.kind === 'table') {
        // Moves into removedTables rather than vanishing — its number is
        // free again (migration 028), and it is one tap from coming back.
        const removed = p.tables.find((t) => t.id === sel.id)
        return {
          ...p,
          tables: p.tables.filter((t) => t.id !== sel.id),
          removedTables: removed ? [...p.removedTables, { ...removed, active: false }] : p.removedTables,
        }
      }
      return { ...p, props: p.props.filter((x) => x.id !== sel.id) }
    })
    setSel(null)
  }

  /** The other half of onDeleteSelected: bring a removed table back,
   *  unplaced, on whichever floor is currently open. */
  async function onRestoreTable(id: string) {
    if (!floorId) return
    setBusy(true)
    const { row, error, code } = await reactivateTable(id, floorId)
    setBusy(false)
    if (error || !row) {
      flash(
        code === UNIQUE_VIOLATION
          ? 'המספר הזה כבר תפוס על ידי שולחן אחר — שנו את המספר שלו לפני השחזור'
          : (error ?? 'לא ניתן לשחזר'),
        true
      )
      return
    }
    setPlan((p) => p && {
      ...p,
      tables: [...p.tables, row],
      removedTables: p.removedTables.filter((t) => t.id !== id),
    })
    setSel({ kind: 'table', id: row.id })
    flash(`שולחן ${row.number} שוחזר — גררו אותו למקום`)
  }

  async function onSetLabel(id: string, label_kind: LabelKind) {
    patchTable(id, { label_kind })
    const err = await setTableLabelKind(id, label_kind)
    if (err) {
      patchTable(id, { label_kind: (selected as FloorTable)?.label_kind ?? null })
      flash('רק אחראי/ת משמרת ומעלה יכולים לערוך', true)
    }
  }

  function onAddFloor() {
    if (!plan) return
    setPromptReq({
      title: 'קומה חדשה',
      body: 'שם הקומה כפי שיוצג לצוות',
      placeholder: 'למשל: גג',
      confirmLabel: 'הוספה',
      onConfirm: (name) => void addFloorNamed(name),
    })
  }

  async function addFloorNamed(name: string) {
    if (!plan) return
    const key = `floor-${Date.now().toString(36)}`
    setBusy(true)
    const { row, error } = await addFloor({ key, name_he: name, sort_order: plan.floors.length })
    setBusy(false)
    if (error || !row) { flash(error ?? 'לא ניתן להוסיף קומה', true); return }
    setPlan((p) => p && { ...p, floors: [...p.floors, row] })
    setFloorId(row.id)
  }

  async function onSave() {
    if (!floorId) return
    setBusy(true)
    const err = await saveFloorLayout(floorId, scoped.tables, scoped.props, canvas)
    setBusy(false)
    if (err) { flash(err, true); return }
    // Fold the (possibly resized) canvas into the floor itself and drop the
    // local override — the database now agrees with it, so re-deriving from
    // `plan` on the next render must land on the same values it just saved.
    setPlan((p) => p && {
      ...p,
      floors: p.floors.map((f) => f.id === floorId
        ? { ...f, canvas_w: Math.round(canvas.w), canvas_h: Math.round(canvas.h), configured: scoped.tables.length > 0 && scoped.tables.every(isPlaced) }
        : f),
    })
    setCanvasOverride(null)
    setDirty(false)
    flash('המפה נשמרה')
  }

  /** Manual room resize, in whole MAGNET cells per axis — the other half of
   *  auto-grow: "reaches the end of the grid" is handled on its own by
   *  snapWithGrowth, this is for an owner who wants to shrink a room back
   *  down once it has emptied out, or grow it ahead of time before dragging
   *  in a wall of new tables. A shrink that would push something already on
   *  the map outside the new bounds is refused rather than silently cropping
   *  or moving anyone's tables. */
  function resizeCanvas(axis: 'w' | 'h', cells: number) {
    const unit = axis === 'w' ? MAGNET.w : MAGNET.h
    const next: Canvas = { ...canvas, [axis]: cells * unit }
    const { cols: newCols, rows: newRows } = gridDims(next)

    for (const o of objects) {
      const span = effSpan(o)
      const { c, r } = anchorOf(o.pos_x!, o.pos_y!, span, canvas)
      if (c + span.w > newCols || r + span.h > newRows) {
        flash('אי אפשר לצמצם — יש פריטים שייצאו מהחדר. הזיזו או מחקו אותם קודם', true)
        return
      }
    }

    const reTables = reanchorAll(scoped.tables, canvas, next)
    const reProps = reanchorAll(scoped.props, canvas, next)
    setPlan((p) => p && {
      ...p,
      tables: p.tables.map((t) => reTables.find((r) => r.id === t.id) ?? t),
      props: p.props.map((x) => reProps.find((r) => r.id === x.id) ?? x),
    })
    setCanvasOverride(next)
    setDirty(true)
  }

  /* ── Render ───────────────────────────────────────────────────────── */

  if (!plan) return <div className="fb-skel" aria-label="טוען" />

  const { cols, rows } = gridDims(canvas)
  const cell = cellSize(canvas)

  return (
    <div className="fb">
      {/* Floors */}
      <div className="fb-floors">
        {plan.floors.map((f) => (
          <button
            key={f.id}
            className={`fb-tab${f.id === floorId ? ' on' : ''}`}
            onClick={() => {
              if (dirty) {
                setConfirmReq({
                  title: 'יש שינויים שלא נשמרו',
                  body: 'לעבור קומה בכל זאת? השינויים שלא נשמרו יאבדו.',
                  confirmLabel: 'מעבר בכל זאת',
                  onConfirm: () => { setFloorId(f.id); setSel(null); setDirty(false); setCanvasOverride(null) },
                })
                return
              }
              setFloorId(f.id); setSel(null); setDirty(false); setCanvasOverride(null)
            }}
          >
            {f.name_he}
            {!f.configured && <span className="fb-dot" title="עדיין לא הוגדרה" />}
          </button>
        ))}
        {canManage && (
          <button className="fb-tab fb-tab--add" onClick={() => void onAddFloor()} disabled={busy}>
            + קומה
          </button>
        )}
      </div>

      {canManage && (
        <div className="fb-tools">
          <button className="fb-btn fb-btn--primary" onClick={() => void onAddTable()} disabled={busy}>
            + שולחן
          </button>
          <div className="fb-group">
            <span className="fb-group-label">גודל החדר</span>
            <div className="fb-steppers">
              <Stepper
                label="עמודות" value={cols} min={MIN_ROOM_CELLS} max={MAX_ROOM_CELLS} disabled={busy}
                onChange={(v) => resizeCanvas('w', v)}
              />
              <Stepper
                label="שורות" value={rows} min={MIN_ROOM_CELLS} max={MAX_ROOM_CELLS} disabled={busy}
                onChange={(v) => resizeCanvas('h', v)}
              />
            </div>
          </div>
          <div className="fb-group">
            <span className="fb-group-label">נקודות ציון</span>
            <div className="fb-chips">
              {PROP_LANDMARKS.map((k) => (
                <button key={k} className="fb-chip fb-chip--lm" data-lm={k}
                  onClick={() => void onAddProp(k)} disabled={busy}>
                  <span aria-hidden="true">{PROP_GLYPH[k]}</span> {PROP_HE[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="fb-group">
            <span className="fb-group-label">חלוקת החלל</span>
            <div className="fb-chips">
              {PROP_OBSTACLES.map((k) => (
                <button key={k} className="fb-chip" onClick={() => void onAddProp(k)} disabled={busy}>
                  {PROP_HE[k]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="fb-main">
        {/* The room. LTR always — physical space does not mirror. */}
        <div className="fb-canvas-wrap">
          <div
            ref={canvasRef}
            className={`fb-canvas${drag ? ' is-dragging' : ''}`}
            dir="ltr"
            style={{ aspectRatio: `${canvas.w} / ${canvas.h}` }}
            onPointerDown={() => setSel(null)}
          >
            {/* Grid guides — a builder needs something to aim at. */}
            <div className="fb-grid" aria-hidden="true" style={{
              backgroundSize: `${100 / cols}% ${100 / rows}%`,
            }} />

            {/* Referenced by every table/prop's aria-describedby below — one
                shared instruction rather than repeating it on every object a
                screen-reader user tabs past. Visually hidden the same way
                the site's own skip-link is (off-screen, not display:none,
                so it stays in the accessibility tree). */}
            <p id="fb-kbd-hint" style={{
              position: 'absolute', width: 1, height: 1, overflow: 'hidden',
              clipPath: 'inset(50%)', whiteSpace: 'nowrap', margin: -1, padding: 0, border: 0,
            }}>
              נבחר. חצים להזזה ברשת.
            </p>

            {dropPreview && (
              <div className="fb-preview" aria-hidden="true" style={{
                left: `${dropPreview.x}%`, top: `${dropPreview.y}%`,
                width: `${dropPreview.w}%`, height: `${dropPreview.h}%`,
              }} />
            )}

            {scoped.props.filter(isPlaced).map((p) => {
              const span = effSpan(p)
              const live = drag?.kind === 'prop' && drag.id === p.id
              return (
                <div
                  key={p.id}
                  className={`fb-obj fb-prop${isLandmark(p.kind) ? ' fb-prop--lm' : ''}`
                    + (sel?.kind === 'prop' && sel.id === p.id ? ' is-sel' : '')
                    + (live ? ' is-live' : '')}
                  data-lm={isLandmark(p.kind) ? p.kind : undefined}
                  style={{
                    left: `${live ? drag!.x : p.pos_x}%`, top: `${live ? drag!.y : p.pos_y}%`,
                    width: `${span.w * cell.pw}%`, height: `${span.h * cell.ph}%`,
                  }}
                  onPointerDown={(e) => onObjectDown(e, 'prop', p)}
                  onPointerMove={onObjectMove}
                  onPointerUp={onObjectUp}
                  onPointerCancel={() => setDrag(null)}
                  /* A17: keyboard alternative to the drag above. */
                  tabIndex={canManage ? 0 : -1}
                  role="button"
                  aria-pressed={sel?.kind === 'prop' && sel.id === p.id}
                  aria-label={p.label || PROP_HE[p.kind]}
                  aria-describedby="fb-kbd-hint"
                  onFocus={() => setSel({ kind: 'prop', id: p.id })}
                  onKeyDown={(e) => onObjectKeyDown(e, 'prop', p)}
                >
                  {isLandmark(p.kind) && <b aria-hidden="true">{PROP_GLYPH[p.kind]}</b>}
                  <span>{p.label || PROP_HE[p.kind]}</span>
                </div>
              )
            })}

            {placedTables.map((t) => {
              const span = effSpan(t)
              const live = drag?.kind === 'table' && drag.id === t.id
              return (
                <div
                  key={t.id}
                  className={`fb-obj fb-table fb-table--${t.kind} fb-table--${t.shape}`
                    + (t.label_kind ? ` fb-table--${t.label_kind}` : '')
                    + (sel?.kind === 'table' && sel.id === t.id ? ' is-sel' : '')
                    + (live ? ' is-live' : '')}
                  style={{
                    left: `${live ? drag!.x : t.pos_x}%`, top: `${live ? drag!.y : t.pos_y}%`,
                    width: `${span.w * cell.pw}%`, height: `${span.h * cell.ph}%`,
                  }}
                  onPointerDown={(e) => onObjectDown(e, 'table', t)}
                  onPointerMove={onObjectMove}
                  onPointerUp={onObjectUp}
                  onPointerCancel={() => setDrag(null)}
                  /* A17: keyboard alternative to the drag above. */
                  tabIndex={canManage ? 0 : -1}
                  role="button"
                  aria-pressed={sel?.kind === 'table' && sel.id === t.id}
                  aria-label={tableName(t)}
                  aria-describedby="fb-kbd-hint"
                  onFocus={() => setSel({ kind: 'table', id: t.id })}
                  onKeyDown={(e) => onObjectKeyDown(e, 'table', t)}
                >
                  <b>{tableName(t)}</b>
                  {t.label_kind && (
                    <span className="fb-tag">{t.label_kind === 'owners' ? 'בעלים' : 'VIP'}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <aside className="fb-side">
          {selected ? (
            <Inspector
              sel={sel!}
              obj={selected}
              canManage={canManage}
              onPatchTable={patchTable}
              onPatchProp={patchProp}
              onReshape={reshape}
              onLabel={onSetLabel}
              onDelete={() => void onDeleteSelected()}
              onUnplace={() => sel!.kind === 'table'
                ? patchTable(sel!.id, { pos_x: null, pos_y: null })
                : patchProp(sel!.id, { pos_x: null, pos_y: null })}
              onClose={() => setSel(null)}
              busy={busy}
            />
          ) : (
            <p className="fb-hint">בחרו שולחן או אלמנט במפה כדי לשנות גודל, סוג או תווית.</p>
          )}

          {unplaced.length > 0 && (
            <section className="fb-unplaced">
              <h3>לא ממוקמים · {unplaced.length}</h3>
              <div className="fb-chips">
                {unplaced.map((t) => (
                  <button key={t.id} className="fb-chip" onClick={() => placeOnMap(t)} disabled={!canManage}>
                    {tableName(t)} ←
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Deleted tables land here rather than vanishing — their numbers
              are free again (migration 028), and restoring is one tap. */}
          {plan.removedTables.length > 0 && canManage && (
            <section className="fb-unplaced fb-removed">
              <h3>הוסרו · {plan.removedTables.length}</h3>
              <div className="fb-chips">
                {plan.removedTables.map((t) => (
                  <button key={t.id} className="fb-chip fb-chip--restore"
                    onClick={() => void onRestoreTable(t.id)} disabled={busy}>
                    ↺ {tableName(t)}
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {canManage && (
        <div className="fb-save">
          <span className={dirty ? 'fb-dirty' : 'fb-clean'}>
            {dirty ? 'יש שינויים שלא נשמרו' : 'הכל שמור'}
          </span>
          <button className="fb-btn fb-btn--primary" disabled={!dirty || busy} onClick={() => void onSave()}>
            {busy ? 'שומר…' : 'שמירת המפה'}
          </button>
        </div>
      )}

      {msg && <div className={`fb-toast${msg.bad ? ' bad' : ''}`} role="status">{msg.text}</div>}

      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
      <PromptSheet request={promptReq} onClose={() => setPromptReq(null)} />
    </div>
  )
}

/* ── Inspector ─────────────────────────────────────────────────────── */

function Inspector({
  sel, obj, canManage, onPatchTable, onPatchProp, onReshape, onLabel, onDelete, onUnplace, onClose, busy,
}: {
  sel: NonNullable<Sel>
  obj: FloorTable | FloorProp
  canManage: boolean
  onPatchTable: (id: string, patch: Partial<FloorTable>) => void
  onPatchProp: (id: string, patch: Partial<FloorProp>) => void
  onReshape: (id: string, kind: 'table' | 'prop', patch: { grid_w?: number; grid_h?: number; rotation?: number }) => void
  onLabel: (id: string, k: LabelKind) => void
  onDelete: () => void
  onUnplace: () => void
  /** Below 900px this renders as a fixed bottom sheet over the canvas (see
   *  floor-builder.css) rather than beside it, so there needs to be a way out
   *  that isn't "tap the part of the canvas the sheet doesn't cover". */
  onClose: () => void
  busy: boolean
}) {
  const isTable = sel.kind === 'table'
  const t = obj as FloorTable
  const p = obj as FloorProp

  return (
    <section className="fb-inspector">
      <header>
        <b>{isTable ? `שולחן ${tableName(t)}` : PROP_HE[p.kind]}</b>
        <button type="button" className="fb-close" onClick={onClose} aria-label="סגירה">✕</button>
      </header>

      {isTable && (
        <>
          <label className="fb-field">
            <span>שם תצוגה</span>
            <input
              value={t.label ?? ''} disabled={!canManage}
              placeholder={String(t.number)}
              onChange={(e) => onPatchTable(t.id, { label: e.target.value || null })}
            />
          </label>
          <label className="fb-field">
            <span>מספר</span>
            <input
              type="number" value={t.number} disabled={!canManage} min={1}
              onChange={(e) => onPatchTable(t.id, { number: Number(e.target.value) || t.number })}
            />
          </label>
          <div className="fb-field">
            <span>סוג</span>
            <div className="fb-seg">
              {(Object.keys(KIND_HE) as TableKind[]).map((k) => (
                <button key={k} className={`fb-seg-b${t.kind === k ? ' on' : ''}`}
                  disabled={!canManage} onClick={() => onPatchTable(t.id, { kind: k })}>
                  {KIND_HE[k]}
                </button>
              ))}
            </div>
          </div>
          <div className="fb-field">
            <span>צורה</span>
            <div className="fb-seg">
              {(['rect', 'round'] as TableShape[]).map((s) => (
                <button key={s} className={`fb-seg-b${t.shape === s ? ' on' : ''}`}
                  disabled={!canManage} onClick={() => onPatchTable(t.id, { shape: s })}>
                  {s === 'rect' ? 'מרובע' : 'עגול'}
                </button>
              ))}
            </div>
          </div>
          <div className="fb-field">
            <span>תווית</span>
            <div className="fb-seg">
              {([null, 'owners', 'vip'] as LabelKind[]).map((k) => (
                <button key={String(k)} className={`fb-seg-b${t.label_kind === k ? ' on' : ''}`}
                  disabled={!canManage} onClick={() => onLabel(t.id, k)}>
                  {k === null ? 'ללא' : k === 'owners' ? 'בעלים' : 'VIP'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {!isTable && (
        <label className="fb-field">
          <span>שם</span>
          <input
            value={p.label ?? ''} disabled={!canManage}
            placeholder={PROP_HE[p.kind]}
            onChange={(e) => onPatchProp(p.id, { label: e.target.value || null })}
          />
        </label>
      )}

      {/* Footprint + rotation route through reshape(), which re-snaps: a table
          that grows must not be left overlapping a neighbour it used to clear. */}
      <div className="fb-field">
        <span>גודל ברשת</span>
        <div className="fb-steppers">
          <Stepper label="רוחב" value={obj.grid_w} min={1} max={isTable ? 4 : 6} disabled={!canManage}
            onChange={(v) => onReshape(obj.id, sel.kind, { grid_w: v })} />
          <Stepper label="גובה" value={obj.grid_h} min={1} max={isTable ? 4 : 6} disabled={!canManage}
            onChange={(v) => onReshape(obj.id, sel.kind, { grid_h: v })} />
        </div>
      </div>

      <div className="fb-row">
        <button className="fb-btn" disabled={!canManage}
          onClick={() => onReshape(obj.id, sel.kind, { rotation: ((obj.rotation + 90) % 360) })}>
          סיבוב 90°
        </button>
        <button className="fb-btn" disabled={!canManage || !isPlaced(obj)} onClick={onUnplace}>
          הסרה מהמפה
        </button>
      </div>

      <button className="fb-btn fb-btn--danger" disabled={!canManage || busy} onClick={onDelete}>
        {isTable ? 'מחיקת השולחן' : 'מחיקה'}
      </button>
      {isTable && (
        <p className="fb-note">שולחן נמחק מושבת ולא נמחק לצמיתות — הזמנות ישנות עדיין מפנות אליו.</p>
      )}
    </section>
  )
}

function Stepper({
  label, value, min, max, disabled, onChange,
}: {
  label: string; value: number; min: number; max: number
  disabled: boolean; onChange: (v: number) => void
}) {
  // haptic('tick') on every step — the finger is doing the deciding here,
  // same rule the shift scheduler's own steppers follow (CLAUDE.md's
  // haptics section names "wheels, steppers" explicitly).
  const step = (v: number) => { haptic('tick'); onChange(v) }
  return (
    <div className="fb-stepper">
      <span>{label}</span>
      <button disabled={disabled || value <= min} onClick={() => step(value - 1)} aria-label={`${label} פחות`}>−</button>
      <b>{value}</b>
      <button disabled={disabled || value >= max} onClick={() => step(value + 1)} aria-label={`${label} עוד`}>+</button>
    </div>
  )
}
