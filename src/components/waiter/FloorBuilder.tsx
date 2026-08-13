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
  addFloor, addProp, addTable, canvasOf, deactivateTable, isLandmark,
  loadFloorPlan, onFloor, PROP_LANDMARKS, PROP_OBSTACLES, removeProp,
  saveFloorLayout, setTableLabelKind, suggestNumber, tableName,
  type Floor, type FloorPlan, type FloorProp, type FloorTable,
  type LabelKind, type PropKind, type TableKind, type TableShape,
} from '@/lib/waiter/floor'
import { cellSize, effSpan, gridDims, isPlaced, snapToGrid, type Canvas } from '@/lib/waiter/grid'
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
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
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
  const canvas: Canvas = canvasOf(floor)
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

  /** Re-snap after a resize or rotation: a table that grew must not be left
   *  overlapping a neighbour it used to clear. */
  const reshape = (id: string, kind: 'table' | 'prop', patch: { grid_w?: number; grid_h?: number; rotation?: number }) => {
    const obj = kind === 'table'
      ? plan?.tables.find((t) => t.id === id)
      : plan?.props.find((p) => p.id === id)
    if (!obj) return
    const next = { ...obj, ...patch }
    if (isPlaced(next)) {
      const others = objects.filter((o) => o.id !== id)
      const spot = snapToGrid(next.pos_x!, next.pos_y!, next, canvas, others)
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

  function onObjectUp(e: React.PointerEvent) {
    if (!drag) return
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* gone */ }
    if (drag.moved) {
      const obj = drag.kind === 'table'
        ? plan?.tables.find((t) => t.id === drag.id)
        : plan?.props.find((x) => x.id === drag.id)
      if (obj) {
        const others = objects.filter((o) => o.id !== drag.id)
        const spot = snapToGrid(drag.x, drag.y, obj, canvas, others)
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
    const spot = snapToGrid(50, 50, t, canvas, objects)
    patchTable(t.id, { pos_x: spot.x, pos_y: spot.y })
    setSel({ kind: 'table', id: t.id })
  }

  /* ── Structural writes (immediate) ────────────────────────────────── */

  async function onAddTable() {
    if (!floorId || !plan) return
    setBusy(true)
    const number = suggestNumber(plan.tables)
    const { row, error } = await addTable({ number, floor_id: floorId })
    setBusy(false)
    if (error || !row) { flash(error ?? 'לא ניתן להוסיף שולחן', true); return }
    setPlan((p) => p && { ...p, tables: [...p.tables, row] })
    setSel({ kind: 'table', id: row.id })
    flash(`שולחן ${number} נוסף — גררו אותו למקום`)
  }

  async function onAddProp(kind: PropKind) {
    if (!floorId) return
    setBusy(true)
    const spot = snapToGrid(50, 50, { grid_w: 1, grid_h: 1, rotation: 0 }, canvas, objects)
    const { row, error } = await addProp({ floor_id: floorId, kind, pos_x: spot.x, pos_y: spot.y })
    setBusy(false)
    if (error || !row) { flash(error ?? 'לא ניתן להוסיף', true); return }
    // Re-snap with the real footprint now that we know it.
    const fixed = snapToGrid(spot.x, spot.y, row, canvas, objects)
    setPlan((p) => p && { ...p, props: [...p.props, { ...row, pos_x: fixed.x, pos_y: fixed.y }] })
    setSel({ kind: 'prop', id: row.id })
    setDirty(true)
  }

  async function onDeleteSelected() {
    if (!sel || !selected) return
    setBusy(true)
    const err = sel.kind === 'table' ? await deactivateTable(sel.id) : await removeProp(sel.id)
    setBusy(false)
    if (err) { flash(err, true); return }
    setPlan((p) => p && (sel.kind === 'table'
      ? { ...p, tables: p.tables.filter((t) => t.id !== sel.id) }
      : { ...p, props: p.props.filter((x) => x.id !== sel.id) }))
    setSel(null)
  }

  async function onSetLabel(id: string, label_kind: LabelKind) {
    patchTable(id, { label_kind })
    const err = await setTableLabelKind(id, label_kind)
    if (err) {
      patchTable(id, { label_kind: (selected as FloorTable)?.label_kind ?? null })
      flash('רק אחראי/ת משמרת ומעלה יכולים לערוך', true)
    }
  }

  async function onAddFloor() {
    if (!plan) return
    const name = window.prompt('שם הקומה החדשה')?.trim()
    if (!name) return
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
    setDirty(false)
    flash('המפה נשמרה')
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
              if (dirty && !window.confirm('יש שינויים שלא נשמרו. לעבור קומה בכל זאת?')) return
              setFloorId(f.id); setSel(null); setDirty(false)
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
    </div>
  )
}

/* ── Inspector ─────────────────────────────────────────────────────── */

function Inspector({
  sel, obj, canManage, onPatchTable, onPatchProp, onReshape, onLabel, onDelete, onUnplace, busy,
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
  busy: boolean
}) {
  const isTable = sel.kind === 'table'
  const t = obj as FloorTable
  const p = obj as FloorProp

  return (
    <section className="fb-inspector">
      <header>
        <b>{isTable ? `שולחן ${tableName(t)}` : PROP_HE[p.kind]}</b>
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
  return (
    <div className="fb-stepper">
      <span>{label}</span>
      <button disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label={`${label} פחות`}>−</button>
      <b>{value}</b>
      <button disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label={`${label} עוד`}>+</button>
    </div>
  )
}
