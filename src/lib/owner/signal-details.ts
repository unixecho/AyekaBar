// The dashboard's drill-downs — what "3 פריטים תקועים" or "2 חשבונות פתוחים"
// actually means when the owner taps it open. Sibling to signals.ts, same
// posture throughout: server-only, service-role, every read independent and
// allowed to fail on its own, called from the same OP-gated page and the
// polling API route that keeps the dashboard live (see /api/owner/dashboard).
//
// Deliberately a SEPARATE module rather than folding into signals.ts: the
// counts/signals that module produces are read on every dashboard load
// (cheap, aggregate), while these four are only needed once something is
// actually expanded — keeping them apart means a future caller of
// readDashboardSignals() never pays for joins it didn't ask for.
//
// Every list here must describe EXACTLY what its sibling number/signal in
// signals.ts already counts — same statuses, same thresholds, same filters
// — imported from there rather than re-typed, so the number above an
// expanded panel and the rows inside it can never disagree.

import { createServiceClient } from '@/lib/supabase/server'
import { MENU_SLUG, loc, fmtPrice, type MenuCategory, type MenuItem } from '@/lib/menu/types'
import {
  IN_FLIGHT_ITEM_STATUSES, OPEN_TAB_STATUSES, STUCK_ITEM_MAX_AGE_HOURS, STUCK_ITEM_MINUTES,
  readTodayShifts, roleLabel,
} from './signals'

type Service = ReturnType<typeof createServiceClient>

export interface StuckItemDetail {
  id: string
  name: string
  qty: number
  station: 'bar' | 'kitchen' | null
  /** null = a quick purchase, which carries no table at all (see readFloor's
   *  own comment in signals.ts — tabs, not tables, is not just a label
   *  choice, some tabs genuinely have neither). */
  table: string | null
  waiterName: string | null
  /** Set only once a bartender/cook has actually claimed the line
   *  (sent → preparing). A line still sitting in `sent` has nobody's name
   *  to show yet — that IS the fact worth surfacing, not a loading gap. */
  stationStaffName: string | null
  waitedMinutes: number
}

export interface OpenTabDetail {
  id: string
  table: string | null
  waiterName: string | null
  agorot: number
  openedAt: string
}

export interface ScheduledPersonDetail {
  staffId: string | null
  staffName: string
  /** One entry per assignment TODAY. A split shift, or the same person
   *  filling two roles on one shift (both schema-permitted — see
   *  readSchedule's own comment in signals.ts), is one person with two
   *  entries here — never two rows. This is what keeps the list's length
   *  matching `scheduledToday`, which counts distinct people. */
  shifts: { roleName: string; start: string; end: string }[]
}

export interface MenuChangeDetail {
  kind: 'added' | 'removed' | 'changed'
  name: string
  category: string
  /** What actually differs, e.g. "מחיר 18 → 20", "סומן כאזל". Absent for
   *  added/removed, where the kind itself is the whole story. */
  note?: string
}

export interface DashboardDetails {
  stuckItems: StuckItemDetail[]
  openTabs: OpenTabDetail[]
  scheduledToday: ScheduledPersonDetail[]
  menuChanges: MenuChangeDetail[]
}

const EMPTY: DashboardDetails = { stuckItems: [], openTabs: [], scheduledToday: [], menuChanges: [] }

function staffFullName(s: { first_name: string | null; last_name: string | null } | undefined | null): string | null {
  if (!s) return null
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ')
  return name || null
}

/** Every item behind the "stuck" count — same statuses, same
 *  age window as readStuckItems() in signals.ts. Three plain queries and an
 *  in-memory join rather than a PostgREST embed: `waiter_order_items` has
 *  five different FKs into `staff` alone (claimed_by is only one of them),
 *  so an embed here would need an explicit constraint-name hint to stay
 *  unambiguous — a separate lookup keyed by id is simpler to read and to
 *  trust, and matches how the rest of this codebase joins across tables
 *  (see waiter_staff_directory in STAFF_APP.md for the same reasoning). */
async function readStuckItemsDetail(service: Service): Promise<StuckItemDetail[]> {
  try {
    const cutoff = new Date(Date.now() - STUCK_ITEM_MINUTES * 60_000).toISOString()
    const floor = new Date(Date.now() - STUCK_ITEM_MAX_AGE_HOURS * 3_600_000).toISOString()

    const { data: items, error } = await service
      .from('waiter_order_items')
      .select('id, name_he, qty, station, sent_at, order_id, claimed_by')
      .in('status', IN_FLIGHT_ITEM_STATUSES)
      .is('ready_at', null)
      .lt('sent_at', cutoff)
      .gt('sent_at', floor)
      .order('sent_at', { ascending: true })
    if (error || !items || items.length === 0) return []

    const orderIds = Array.from(new Set(items.map((i) => i.order_id).filter((id): id is string => !!id)))
    const staffIds = Array.from(new Set(items.map((i) => i.claimed_by).filter((id): id is string => !!id)))

    const [{ data: orders }, { data: staffRows }] = await Promise.all([
      orderIds.length
        ? service.from('waiter_orders').select('id, table_number, table_label, waiter_name').in('id', orderIds)
        : Promise.resolve({ data: [] as { id: string; table_number: number | null; table_label: string | null; waiter_name: string | null }[] }),
      staffIds.length
        ? service.from('staff').select('id, first_name, last_name').in('id', staffIds)
        : Promise.resolve({ data: [] as { id: string; first_name: string | null; last_name: string | null }[] }),
    ])

    const orderById = new Map((orders ?? []).map((o) => [o.id, o]))
    const staffById = new Map((staffRows ?? []).map((s) => [s.id, s]))

    return items.map((i) => {
      const order = i.order_id ? orderById.get(i.order_id) : null
      const waited = i.sent_at ? Math.round((Date.now() - Date.parse(i.sent_at)) / 60_000) : 0
      return {
        id: i.id,
        name: i.name_he,
        qty: i.qty,
        station: (i.station as 'bar' | 'kitchen' | null) ?? null,
        table: order?.table_label ?? (order?.table_number != null ? String(order.table_number) : null),
        waiterName: order?.waiter_name ?? null,
        stationStaffName: i.claimed_by ? staffFullName(staffById.get(i.claimed_by)) : null,
        waitedMinutes: Number.isFinite(waited) ? Math.max(0, waited) : 0,
      }
    })
  } catch {
    return []
  }
}

/** Every tab behind the "open tabs" / "על הרצפה" pair — readFloor()'s own
 *  count, one column list wider. No join needed at all: waiter_name and the
 *  table's own number/label are denormalised straight onto waiter_orders at
 *  write time (same reasoning fileBatch's items payload gives in
 *  ayeka-staff — read once, not re-derived by every reader). */
async function readOpenTabsDetail(service: Service): Promise<OpenTabDetail[]> {
  try {
    const { data, error } = await service
      .from('waiter_orders')
      .select('id, table_number, table_label, waiter_name, total_agorot, opened_at')
      .in('status', OPEN_TAB_STATUSES)
      .order('opened_at', { ascending: true })
    if (error || !data) return []
    return data.map((o) => ({
      id: o.id,
      table: o.table_label ?? (o.table_number != null ? String(o.table_number) : null),
      waiterName: o.waiter_name ?? null,
      agorot: o.total_agorot ?? 0,
      openedAt: o.opened_at,
    }))
  } catch {
    return []
  }
}

/** Every person behind "משובצים היום" — readSchedule()'s own todayStaff SET,
 *  one row per DISTINCT person, so the list's length always matches the
 *  number above it (a split shift or a double-role shift is one person with
 *  two entries in `shifts`, never two rows — see readSchedule's own comment
 *  in signals.ts for why the count itself is deduplicated this way; a
 *  drill-down that wasn't would show more rows than the header claims).
 *  No staff lookup needed: the published snapshot already froze a display
 *  name onto each assignment at publish time (see SnapshotShift's own
 *  comment in signals.ts) — reading it straight off the snapshot is also
 *  more honest than a live join would be, since it shows the name as it was
 *  PUBLISHED, matching what the staff schedule and the print sheet show
 *  today, even if someone's since been renamed. Falls back to
 *  roleLabel(roleId) when a shift predates staffName being written into the
 *  snapshot. */
async function readScheduledTodayDetail(service: Service): Promise<ScheduledPersonDetail[]> {
  try {
    const { today, shifts, known } = await readTodayShifts(service)
    if (!known) return []

    const byStaff = new Map<string, ScheduledPersonDetail>()
    for (const shift of shifts) {
      if (shift.date !== today) continue
      for (const a of shift.assignments ?? []) {
        if (!a.staffId) continue
        const entry = byStaff.get(a.staffId) ?? {
          staffId: a.staffId,
          staffName: a.staffName?.trim() || 'ללא שם',
          shifts: [],
        }
        entry.shifts.push({
          roleName: roleLabel(a.roleId ?? ''),
          start: (shift.start ?? '').slice(0, 5),
          end: (shift.end ?? '').slice(0, 5),
        })
        byStaff.set(a.staffId, entry)
      }
    }

    const out = Array.from(byStaff.values())
    for (const person of out) person.shifts.sort((x, y) => x.start.localeCompare(y.start))
    out.sort((x, y) => (x.shifts[0]?.start ?? '').localeCompare(y.shifts[0]?.start ?? ''))
    return out
  } catch {
    return []
  }
}

/** One line of "what differs", for an item present on both sides. Covers
 *  availability, all three languages' name and description, and price —
 *  the fields a bar owner actually recognises as a menu edit. Anything else
 *  in MenuItem (options, badges, image) is real but not spelled out here;
 *  readMenuChangesDetail's own fallback line catches whatever this misses
 *  rather than leaving it unexplained. */
function itemChangeNote(a: MenuItem, b: MenuItem): string | null {
  const notes: string[] = []
  if ((a.available ?? true) !== (b.available ?? true)) {
    notes.push(b.available === false ? 'סומן כאזל' : 'הוחזר למלאי')
  }

  const heA = a.he ?? ''; const heB = b.he ?? ''
  if (heA !== heB) notes.push(`שם: ${heA || '—'} ← ${heB || '—'}`)
  // en/ar checked for CHANGE ONLY, not shown verbatim — this panel is
  // Hebrew-only like the rest of the owner surface (CLAUDE.md's i18n rule is
  // about customer-facing strings, not this admin screen), but a translation
  // edit is still real and must not vanish just because it isn't the he name.
  if (!(heA !== heB) && ((a.en ?? '') !== (b.en ?? '') || (a.ar ?? '') !== (b.ar ?? ''))) {
    notes.push('השם בשפה אחרת עודכן')
  }

  const noteA = a.note ?? {}; const noteB = b.note ?? {}
  if ((noteA.he ?? '') !== (noteB.he ?? '') || (noteA.en ?? '') !== (noteB.en ?? '') || (noteA.ar ?? '') !== (noteB.ar ?? '')) {
    notes.push('התיאור עודכן')
  }

  const priceA = fmtPrice(a.price); const priceB = fmtPrice(b.price)
  if (priceA !== priceB) notes.push(`מחיר: ${priceB || '—'} ← ${priceA || '—'}`)

  return notes.length ? notes.join(' · ') : null
}

/** Every item behind "שינויים בתפריט לא פורסמו" — a shallow draft-vs-
 *  published diff by item `uid` (categories by `id`), not a generic deep
 *  diff: this exists to answer "what did I just edit and forget to
 *  publish", so added/removed/available/name/price is the whole story that
 *  matters. An item on either side missing its `uid` (pre-ensureUids()
 *  legacy data) cannot be tracked and is silently skipped rather than
 *  guessed at by position, which reorders constantly.
 *
 *  ── A "removed+added" pair is usually one item, not two ─────────────
 *  Confirmed against production: the same drink existed on both sides with
 *  DIFFERENT uids (re-minted by a later ensureUids() pass, not a real
 *  delete-and-recreate). Matched purely by uid, that reads as "Heineken
 *  removed" AND "Heineken added" — technically true of the ids, false of
 *  what happened. Before reporting either list, any add/remove pair that
 *  shares a category and an exact he name is reconciled into a single
 *  `changed` row (or dropped entirely if nothing else differs) — the same
 *  reconciliation a human scanning both lists would do by eye. */
async function readMenuChangesDetail(service: Service): Promise<MenuChangeDetail[]> {
  try {
    const { data, error } = await service
      .from('menus')
      .select('draft, published')
      .eq('slug', MENU_SLUG)
      .maybeSingle()
    if (error || !data?.draft) return []

    const draftCats = (data.draft.categories as MenuCategory[] | undefined) ?? []
    const pubCats = (data.published?.categories as MenuCategory[] | undefined) ?? []

    const catTitle = (cats: MenuCategory[], id: string) =>
      loc(cats.find((c) => c.id === id)?.title, 'he') || id

    const draftByUid = new Map<string, { item: MenuItem; catId: string }>()
    for (const cat of draftCats) for (const item of cat.items ?? []) {
      if (item.uid) draftByUid.set(item.uid, { item, catId: cat.id })
    }
    const pubByUid = new Map<string, { item: MenuItem; catId: string }>()
    for (const cat of pubCats) for (const item of cat.items ?? []) {
      if (item.uid) pubByUid.set(item.uid, { item, catId: cat.id })
    }

    // Array.from(), not for…of — this tsconfig has no ES2015+ target, and
    // iterating a Map directly fails the build (tsconfig-no-target-es5).
    const changed: MenuChangeDetail[] = []
    const added: { item: MenuItem; catId: string; reconciled?: boolean }[] = []
    const removed: { item: MenuItem; catId: string }[] = []

    for (const [uid, entry] of Array.from(draftByUid)) {
      const inPub = pubByUid.get(uid)
      if (!inPub) { added.push(entry); continue }
      const note = itemChangeNote(inPub.item, entry.item)
      if (note) changed.push({ kind: 'changed', name: loc(entry.item, 'he') || 'ללא שם', category: catTitle(draftCats, entry.catId), note })
    }
    for (const [uid, entry] of Array.from(pubByUid)) {
      if (!draftByUid.has(uid)) removed.push(entry)
    }

    // Reconcile: same category + same he name on both "sides" of the
    // add/remove split is one item whose uid drifted, not two items.
    const usedRemoved = new Set<number>()
    for (const a of added) {
      const nameA = loc(a.item, 'he')
      const ri = removed.findIndex((r, i) =>
        !usedRemoved.has(i) && r.catId === a.catId && loc(r.item, 'he') === nameA
      )
      if (ri === -1) continue
      usedRemoved.add(ri)
      const note = itemChangeNote(removed[ri].item, a.item)
      if (note) changed.push({ kind: 'changed', name: nameA || 'ללא שם', category: catTitle(draftCats, a.catId), note })
      a.reconciled = true
    }

    for (const a of added) {
      if (!a.reconciled) changed.push({ kind: 'added', name: loc(a.item, 'he') || 'ללא שם', category: catTitle(draftCats, a.catId) })
    }
    removed.forEach((r, i) => {
      if (!usedRemoved.has(i)) changed.push({ kind: 'removed', name: loc(r.item, 'he') || 'ללא שם', category: catTitle(pubCats, r.catId) })
    })

    // Categories themselves — added, removed, renamed. Matched by `id`
    // (stable, unlike an item's uid which needs the reconciliation above).
    const pubCatIds = new Set(pubCats.map((c) => c.id))
    const draftCatIds = new Set(draftCats.map((c) => c.id))
    for (const cat of draftCats) {
      if (!pubCatIds.has(cat.id)) {
        changed.push({ kind: 'added', name: loc(cat.title, 'he') || 'ללא שם', category: 'קטגוריה חדשה' })
      }
    }
    for (const cat of pubCats) {
      if (!draftCatIds.has(cat.id)) {
        changed.push({ kind: 'removed', name: loc(cat.title, 'he') || 'ללא שם', category: 'קטגוריה הוסרה' })
      }
    }
    for (const dCat of draftCats) {
      const pCat = pubCats.find((c) => c.id === dCat.id)
      if (!pCat) continue
      const dTitle = loc(dCat.title, 'he'); const pTitle = loc(pCat.title, 'he')
      if (dTitle !== pTitle) {
        changed.push({ kind: 'changed', name: dTitle || 'ללא שם', category: 'שם קטגוריה', note: `${pTitle || '—'} ← ${dTitle || '—'}` })
      }
    }

    // ── The safety net ───────────────────────────────────────────────
    // readMenu()'s own `drifted` check (signals.ts) is a full JSON.stringify
    // comparison — the TRUE source of whether "שינויים בתפריט לא פורסמו"
    // fires at all. Everything above is a best-effort field-by-field
    // explanation of THAT diff, not a re-derivation of it, so a field this
    // function doesn't know to look at (an option, a badge, an image, a
    // reordered category) can drift the two sides while producing zero rows
    // here. An expanded panel that says "אין שינויים" while the alert above
    // it insists something changed is worse than no detail at all — it
    // reads as the alert being wrong. This line guarantees the panel is
    // never empty when the signal is firing, even for a field nobody
    // thought to diff by name.
    if (changed.length === 0 && JSON.stringify(data.draft) !== JSON.stringify(data.published ?? null)) {
      changed.push({
        kind: 'changed',
        name: 'שינוי שלא זוהה בפירוט',
        category: '—',
        note: 'יש הבדל בין הטיוטה לגרסה המפורסמת — לתפריט לבדיקה',
      })
    }

    return changed
  } catch {
    return []
  }
}

/** Everything an expanded dashboard panel needs, in one call — mirrors
 *  readDashboardSignals()'s own shape and failure posture: never throws, a
 *  broken read drops its own list and nothing else. */
export async function readDashboardDetails(): Promise<DashboardDetails> {
  let service: Service
  try {
    service = createServiceClient()
  } catch {
    return EMPTY
  }

  const [stuckItems, openTabs, scheduledToday, menuChanges] = await Promise.all([
    readStuckItemsDetail(service),
    readOpenTabsDetail(service),
    readScheduledTodayDetail(service),
    readMenuChangesDetail(service),
  ])

  return { stuckItems, openTabs, scheduledToday, menuChanges }
}
