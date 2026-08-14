// The floor plan, from the portal's side.
//
// The waiter app READS this layout to work a shift; the portal is where it
// gets BUILT. Both talk to the same three tables and the same RLS — nothing
// here is privileged, and that is on purpose: the builder runs on the signed-in
// manager's own session, so `is_floor_manager()` (migration 022) is the single
// gate. There is no service-role API route to get wrong.
//
// Structural changes (adding a table, deleting one, setting Owners/VIP) are
// written IMMEDIATELY — they are discrete decisions, and a half-finished
// layout should not be able to lose them. Geometry (position, size, rotation)
// is batched into an explicit Save, because dragging fifteen tables into place
// is one act of arranging, not fifteen.

import { createClient } from '@/lib/supabase/client'
import { isPlaced, type Canvas, type Placeable } from './grid'

export type TableKind = 'regular' | 'large' | 'tall' | 'booth' | 'bar'
export type TableShape = 'rect' | 'round'
export type LabelKind = 'owners' | 'vip' | null

/** Obstacles block cells so the spacing is honest; landmarks are the fixed
 *  points staff navigate by. Both live in waiter_floor_props (migration 026). */
export type PropObstacle = 'hostess' | 'wall' | 'divider' | 'plant' | 'spacer' | 'station' | 'custom'
export type PropLandmark = 'entrance' | 'kitchen' | 'wc' | 'bar' | 'register'
export type PropKind = PropObstacle | PropLandmark

export const PROP_LANDMARKS: PropLandmark[] = ['entrance', 'kitchen', 'bar', 'register', 'wc']
export const PROP_OBSTACLES: PropObstacle[] = ['hostess', 'wall', 'divider', 'plant', 'spacer', 'station']

export const isLandmark = (k: PropKind): k is PropLandmark =>
  (PROP_LANDMARKS as string[]).includes(k)

/** Starting footprint per kind, so a new object arrives looking like the thing
 *  it represents rather than as a 1×1 square the owner has to fix first. */
export function defaultPropSpan(kind: PropKind): { grid_w: number; grid_h: number } {
  switch (kind) {
    case 'wall': return { grid_w: 3, grid_h: 1 }
    case 'bar': return { grid_w: 3, grid_h: 1 }
    case 'kitchen': return { grid_w: 2, grid_h: 2 }
    case 'hostess': return { grid_w: 2, grid_h: 1 }
    case 'entrance': return { grid_w: 2, grid_h: 1 }
    case 'divider': return { grid_w: 2, grid_h: 1 }
    default: return { grid_w: 1, grid_h: 1 }
  }
}

export interface FloorTable extends Placeable {
  id: string
  number: number
  label: string | null
  zone: string | null
  seats: number | null
  floor_id: string | null
  kind: TableKind
  shape: TableShape
  label_kind: LabelKind
  held_by_staff_id: string | null
}

export interface FloorProp extends Placeable {
  id: string
  floor_id: string
  kind: PropKind
  label: string | null
  active: boolean
}

export interface Floor {
  id: string
  key: string
  name_he: string
  name_en: string | null
  canvas_w: number
  canvas_h: number
  configured: boolean
  sort_order: number
}

export interface FloorPlan {
  floors: Floor[]
  tables: FloorTable[]
  props: FloorProp[]
  /** Deactivated tables — migration 028 means their numbers are already free
   *  for reuse, and this is the one-tap way to actually reuse the ROW rather
   *  than retyping the number into a brand-new table. Never mixed into
   *  `tables`, so nothing that already filters that array (unplaced, magnet
   *  grid, hour totals) has to learn about a third state. */
  removedTables: FloorTable[]
}

export const tableName = (t: FloorTable) => t.label ?? String(t.number)

const TABLE_COLS =
  'id,number,label,zone,seats,pos_x,pos_y,floor_id,kind,shape,grid_w,grid_h,rotation,label_kind,held_by_staff_id'

export async function loadFloorPlan(): Promise<FloorPlan> {
  const supabase = createClient()
  const [floors, tables, props] = await Promise.all([
    supabase.from('waiter_floors')
      .select('id,key,name_he,name_en,canvas_w,canvas_h,configured,sort_order')
      .eq('active', true).order('sort_order'),
    // Both states in one query — split client-side — rather than two round
    // trips. `active` is never used to filter WHICH rows exist here.
    supabase.from('waiter_tables').select(`${TABLE_COLS},active`).order('number'),
    supabase.from('waiter_floor_props')
      .select('id,floor_id,kind,label,pos_x,pos_y,grid_w,grid_h,rotation,active')
      .eq('active', true),
  ])
  const rows = (tables.data ?? []) as (FloorTable & { active: boolean })[]
  return {
    floors: (floors.data ?? []) as Floor[],
    tables: rows.filter((t) => t.active),
    removedTables: rows.filter((t) => !t.active),
    props: (props.data ?? []) as FloorProp[],
  }
}

/** Legacy tables carry floor_id null; they belong to the first floor so that
 *  nothing silently vanishes from the map mid-transition. */
export function onFloor(plan: FloorPlan, floorId: string) {
  const isFirst = plan.floors[0]?.id === floorId
  return {
    tables: plan.tables.filter((t) => t.floor_id === floorId || (t.floor_id === null && isFirst)),
    props: plan.props.filter((p) => p.floor_id === floorId),
  }
}

export const canvasOf = (f: Floor | undefined): Canvas =>
  f ? { w: f.canvas_w, h: f.canvas_h, configured: f.configured } : { w: 560, h: 720, configured: false }

/* ── Structural writes: immediate ──────────────────────────────────── */

export interface NewTable {
  number: number
  label?: string | null
  zone?: string | null
  seats?: number | null
  floor_id: string
  kind?: TableKind
  shape?: TableShape
  grid_w?: number
  grid_h?: number
}

/** Postgres unique_violation. `waiter_tables.number` is unique across ALL
 *  rows, active or not — a deactivated table's number is not actually free,
 *  even though `suggestNumber()` (fed only active rows) thinks it is. See the
 *  retry loop in FloorBuilder's `onAddTable`. */
export const UNIQUE_VIOLATION = '23505'

export async function addTable(
  t: NewTable
): Promise<{ row: FloorTable | null; error: string | null; code: string | null }> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('waiter_tables')
    .insert({
      number: t.number,
      label: t.label?.trim() || null,
      zone: t.zone?.trim() || null,
      seats: t.seats ?? null,
      floor_id: t.floor_id,
      kind: t.kind ?? 'regular',
      shape: t.shape ?? 'rect',
      grid_w: t.grid_w ?? 1,
      grid_h: t.grid_h ?? 1,
    })
    .select(TABLE_COLS)
    .maybeSingle()
  return { row: (data as FloorTable) ?? null, error: error?.message ?? null, code: error?.code ?? null }
}

/** Tables are deactivated, never deleted — historical orders still point at
 *  them, and a bill that cannot name its table is worthless. */
export async function deactivateTable(id: string): Promise<string | null> {
  const supabase = createClient()
  const { error } = await supabase.from('waiter_tables')
    .update({ active: false, updated_at: new Date().toISOString() }).eq('id', id)
  return error?.message ?? null
}

/**
 * Bring a deactivated table back — the other half of `deactivateTable`.
 * Dropped onto `floorId` UNPLACED (position cleared) rather than at its old
 * spot: the room may well have changed since it was removed, and "reappears
 * in the unplaced pool, drag it where you actually want it" is the same
 * flow `placeOnMap` already gives a brand-new table.
 *
 * Can fail on `waiter_tables_active_number_key` (migration 028) if some
 * OTHER table has since claimed this one's old number — a real possibility,
 * since deactivating is exactly what frees a number for reuse. The caller
 * decides how to word that; this only reports it.
 */
export async function reactivateTable(
  id: string, floorId: string
): Promise<{ row: FloorTable | null; error: string | null; code: string | null }> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('waiter_tables')
    .update({ active: true, floor_id: floorId, pos_x: null, pos_y: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(TABLE_COLS)
    .maybeSingle()
  return { row: (data as FloorTable) ?? null, error: error?.message ?? null, code: error?.code ?? null }
}

export async function addProp(p: {
  floor_id: string; kind: PropKind; label?: string | null
  pos_x?: number | null; pos_y?: number | null; grid_w?: number; grid_h?: number
}): Promise<{ row: FloorProp | null; error: string | null }> {
  const supabase = createClient()
  const span = defaultPropSpan(p.kind)
  const { data, error } = await supabase
    .from('waiter_floor_props')
    .insert({
      floor_id: p.floor_id, kind: p.kind, label: p.label?.trim() || null,
      pos_x: p.pos_x ?? null, pos_y: p.pos_y ?? null,
      grid_w: p.grid_w ?? span.grid_w, grid_h: p.grid_h ?? span.grid_h, rotation: 0,
    })
    .select('id,floor_id,kind,label,pos_x,pos_y,grid_w,grid_h,rotation,active')
    .maybeSingle()
  return { row: (data as FloorProp) ?? null, error: error?.message ?? null }
}

export async function removeProp(id: string): Promise<string | null> {
  const supabase = createClient()
  const { error } = await supabase.from('waiter_floor_props')
    .update({ active: false, updated_at: new Date().toISOString() }).eq('id', id)
  return error?.message ?? null
}

/** Owners/VIP is written on its own rather than batched into Save: it is an
 *  operational fact the floor needs NOW, and the database stamps who set it. */
export async function setTableLabelKind(id: string, label_kind: LabelKind): Promise<string | null> {
  const supabase = createClient()
  const { error } = await supabase.from('waiter_tables').update({ label_kind }).eq('id', id)
  return error?.message ?? null
}

export async function addFloor(f: {
  key: string; name_he: string; name_en?: string; sort_order: number
}): Promise<{ row: Floor | null; error: string | null }> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('waiter_floors')
    .insert({ key: f.key, name_he: f.name_he, name_en: f.name_en ?? null, sort_order: f.sort_order })
    .select('id,key,name_he,name_en,canvas_w,canvas_h,configured,sort_order')
    .maybeSingle()
  return { row: (data as Floor) ?? null, error: error?.message ?? null }
}

/* ── Geometry: batched into Save ───────────────────────────────────── */

/**
 * Persist one floor's whole layout plus a single append-only history row.
 *
 * The actor is NOT a parameter — migration 022's trigger stamps it from the
 * session. Passing one in would imply a caller could choose, which is the
 * property the OAuth migration deliberately removed.
 */
export async function saveFloorLayout(
  floorId: string,
  tables: FloorTable[],
  props: FloorProp[],
  canvas: Canvas
): Promise<string | null> {
  const supabase = createClient()
  const stamp = new Date().toISOString()

  // PATCH per row: PostgREST has no multi-row update with differing values,
  // and a floor is a few dozen rows at most.
  //
  // `number` belongs here, not just in the history snapshot below — it used
  // to be missing from this payload entirely, so retyping a table's number
  // in the inspector updated the on-screen card and the local `dirty` flag,
  // Save reported success, and the database quietly kept the OLD number.
  // The portal and the OMS app read the same table live, so the two showed
  // different numbers for the same physical table — which is exactly what
  // was reported.
  const results = await Promise.all([
    ...tables.map((t) =>
      supabase.from('waiter_tables').update({
        number: t.number,
        pos_x: t.pos_x, pos_y: t.pos_y, label: t.label, zone: t.zone, seats: t.seats,
        floor_id: floorId, kind: t.kind, shape: t.shape,
        grid_w: t.grid_w, grid_h: t.grid_h, rotation: t.rotation, updated_at: stamp,
      }).eq('id', t.id)
    ),
    ...props.map((p) =>
      supabase.from('waiter_floor_props').update({
        pos_x: p.pos_x, pos_y: p.pos_y, grid_w: p.grid_w, grid_h: p.grid_h,
        rotation: p.rotation, label: p.label, updated_at: stamp,
      }).eq('id', p.id)
    ),
  ])
  const failed = results.find((r) => r.error)
  if (failed?.error) {
    // Two tables given the same number in one sitting (or swapped numbers,
    // which fails on whichever row's UPDATE lands first) hits the active-only
    // unique index (migration 028) — surface that plainly rather than the
    // raw Postgres constraint name.
    if (failed.error.code === UNIQUE_VIOLATION) return 'שני שולחנות קיבלו אותו מספר — בדקו את המספרים ונסו שוב'
    return failed.error.message
  }

  const configured = tables.length > 0 && tables.every(isPlaced)
  const floorUpdate = await supabase.from('waiter_floors').update({
    canvas_w: Math.round(canvas.w), canvas_h: Math.round(canvas.h),
    configured, updated_at: stamp,
  }).eq('id', floorId)
  if (floorUpdate.error) return floorUpdate.error.message

  // A full snapshot per save. The previous→new diff is derivable, and a
  // snapshot survives schema drift far better than a stream of deltas.
  await supabase.from('waiter_floor_history').insert({
    floor_id: floorId,
    canvas_w: Math.round(canvas.w),
    canvas_h: Math.round(canvas.h),
    layout: {
      tables: tables.map((t) => ({
        id: t.id, number: t.number, pos_x: t.pos_x, pos_y: t.pos_y,
        kind: t.kind, shape: t.shape, grid_w: t.grid_w, grid_h: t.grid_h,
        rotation: t.rotation, label_kind: t.label_kind,
      })),
      props: props.map((p) => ({
        id: p.id, kind: p.kind, label: p.label, pos_x: p.pos_x, pos_y: p.pos_y,
        grid_w: p.grid_w, grid_h: p.grid_h, rotation: p.rotation,
      })),
    },
  })

  return null
}

/** The lowest unused table number, so adding a table does not start with a
 *  collision the owner has to resolve. */
export function suggestNumber(tables: { number: number }[]): number {
  const taken = new Set(tables.map((t) => t.number))
  for (let n = 1; n < 999; n++) if (!taken.has(n)) return n
  return 1
}
