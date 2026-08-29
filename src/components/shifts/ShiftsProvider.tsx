'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { canDelegateSchedule, canManageSchedule, type ScheduleAccessRow } from '@/lib/shifts/access'
import { MockShiftsSource, clearPersisted } from '@/lib/shifts/mock'
import { SupabaseShiftsSource } from '@/lib/shifts/supabase-source'
import { t as translate, type StringKey } from '@/lib/shifts/i18n'
import { todayIn, weekStartOf } from '@/lib/shifts/time'
import { OPTIMISTIC_ID_PREFIX, reduce } from '@/lib/shifts/store'
import type { ShiftsDataSource } from '@/lib/shifts/adapter'
import type { ActionContext, ScheduleAction, ShiftsDB } from '@/lib/shifts/store'
import type { ISODate, Lang, Tri } from '@/lib/shifts/types'

// The module carries its own stylesheet rather than appending to globals.css.
// Importing it here — from the one component every schedule surface mounts —
// means neither route tree needs a layout whose only job is a CSS import, and
// lifting the module into another project stays a directory copy.
import '@/components/shifts/shifts.css'

// One provider for both surfaces. It owns three things and nothing else: the
// database, the language, and who is looking.
//
// THE SOURCE IS CREATED IN AN EFFECT, NOT IN RENDER.
// The mock reads localStorage, which does not exist while Next renders this on
// the server. Constructing it during render would hand the server the seeded
// week and the browser the persisted one, and React would report that as a
// hydration mismatch — a confusing error whose actual cause is three files
// away. Rendering a skeleton until the effect has run is also just what the
// rest of this app does while it waits for data.
//
// WRITES ARE OPTIMISTIC. `dispatch()` runs the action through the SAME pure
// reducer the mock and the server-side writer agree on, paints that instantly,
// and only then sends it. When the server's own re-read comes back it REPLACES
// the optimistic state wholesale — the server is still the only authority, and
// the route still answers with a fresh read of what actually landed rather
// than an optimistic merge (see api/shifts/dispatch/route.ts). All that
// changed is who waits: the manager doesn't.
//
// Three details make that safe rather than merely fast:
//
//   1. `pending` — every action still in flight, in order. A server response
//      that arrives while later edits are outstanding is not the final word,
//      so those later actions are re-applied on top of it. Without this, the
//      response to "remove Dana" would erase the "add Yossi" that came after.
//   2. `chain` — the network calls are serialised. `shift.create` followed by
//      an edit to that shift must reach Postgres in that order, and HTTP makes
//      no such promise on its own.
//   3. `confirmed` — the last state the server actually vouched for. A failed
//      write rolls back to it (plus whatever is still pending), so a rejected
//      edit disappears rather than lingering as a lie on screen.
//
// A write that fails surfaces as a toast. Silently reverting would be worse
// than the old blocking behaviour, not better.

export interface Viewer {
  /** `staff.id`, or null for someone signed in who is not on the roster. */
  staffId: string | null
  name: string
  canManage: boolean
  canDelegate: boolean
}

interface ShiftsContext {
  db: ShiftsDB
  lang: Lang
  setLang: (lang: Lang) => void
  /** Translate a dictionary key. */
  t: (key: StringKey) => string
  /** Render a `Tri` that came from data (a role name, a venue name). */
  tri: (value: Tri) => string
  viewer: Viewer
  /** Prototype-only: pretend to be a different member of the demo roster. */
  setViewerStaffId: (staffId: string) => void
  dispatch: (action: ScheduleAction) => Promise<void>
  /** How many writes are still in flight. Zero almost always, because the
   *  screen no longer waits for them — exposed so a surface that wants to
   *  say "still saving" on a bad connection can. */
  pending: number
  /** Re-read the currently loaded window without an action — the roster
   *  panel's live-updating poll uses this, not dispatch(). */
  refresh: () => Promise<void>
  resetDemo: () => Promise<void>
  isMock: boolean
  today: string
}

const Ctx = createContext<ShiftsContext | null>(null)

export function useShifts(): ShiftsContext {
  const value = useContext(Ctx)
  if (!value) throw new Error('useShifts() called outside <ShiftsProvider>')
  return value
}

export default function ShiftsProvider({
  access, actorName, fallbackStaffId, children,
}: {
  /** The signed-in person's staff row (id, role, badge). */
  access: ScheduleAccessRow
  actorName: string
  /** Whom to view the schedule AS when the signed-in user is not part of the
   *  demo roster. Prototype affordance only. */
  fallbackStaffId?: string
  children: ReactNode
}) {
  const sourceRef = useRef<ShiftsDataSource | null>(null)
  const [db, setDb] = useState<ShiftsDB | null>(null)
  const [lang, setLangState] = useState<Lang>('he')
  const [viewAs, setViewAs] = useState<string | null>(null)

  // ---- optimistic write plumbing (see the header) --------------------------
  /** Actions sent but not yet answered, oldest first. */
  const pendingRef = useRef<ScheduleAction[]>([])
  const [pending, setPending] = useState(0)
  /** The newest state the server itself produced — what a failure rolls back to. */
  const confirmedRef = useRef<ShiftsDB | null>(null)
  /** Serialises the network calls so Postgres sees them in the order they were made. */
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const optimisticSeq = useRef(0)
  const [writeError, setWriteError] = useState<string | null>(null)

  /** Ids and a clock for the LOCAL preview only. Every one of these is thrown
   *  away the moment the server answers with the real row, which is why a
   *  counter is enough and a uuid would be theatre — but the PREFIX matters:
   *  see `OPTIMISTIC_ID_PREFIX` in store.ts for what reads it and why. */
  const localContext = useCallback((): ActionContext => ({
    actorId: access.id ?? null,
    actorName,
    now: new Date().toISOString(),
    id: () => `${OPTIMISTIC_ID_PREFIX}${(optimisticSeq.current += 1).toString(36)}`,
  }), [access.id, actorName])

  /** Fold the still-outstanding actions back on top of a server state. */
  const replay = useCallback((base: ShiftsDB, actions: ScheduleAction[]): ShiftsDB => {
    let next = base
    for (const action of actions) next = reduce(next, action, localContext()).db
    return next
  }, [localContext])

  useEffect(() => {
    // ?demo=1 forces the localStorage prototype even when real data is
    // available — kept for demos so nobody has to roster the live team just
    // to show the builder. Every other load is the real source.
    const demo = new URLSearchParams(window.location.search).get('demo') === '1'
    const source: ShiftsDataSource = demo
      ? new MockShiftsSource({ id: access.id ?? null, name: actorName })
      : new SupabaseShiftsSource()
    sourceRef.current = source

    // A Sunday-aligned guess for the FIRST fetch's 3-week window — venueless
    // and timezoneless by necessity, since neither is known before the first
    // response arrives. It only has to be close: once `db.venue` loads,
    // ScheduleWorkspace computes the real `weekStartFor(today, db.venue)` in
    // the venue's own timezone and re-centres via its existing
    // `week.ensure` navigation effect if this guess was ever a week off.
    const now = new Date()
    const todayGuess: ISODate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    source.load(weekStartOf(todayGuess, 0)).then((loaded) => {
      confirmedRef.current = loaded
      setDb(loaded)
    })

    // The language choice is shared with the rest of the app — the portal and
    // the menu already persist it under this key, and a manager who set the
    // site to English should not find the schedule in Hebrew.
    try {
      const saved = window.localStorage.getItem('siteLanguage')
      if (saved === 'he' || saved === 'en' || saved === 'ar') setLangState(saved)
    } catch {
      /* storage disabled — Hebrew, the default, is correct anyway */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try { window.localStorage.setItem('siteLanguage', next) } catch { /* ignore */ }
  }, [])

  // Keep <html lang/dir> in step, exactly as useLanguage() in
  // components/LanguageSwitch.tsx does for the portal and the menu. Without
  // it the English strings render inside an RTL document: the text is
  // left-to-right, the layout is not, and every chevron points the wrong way.
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl'
  }, [lang])

  const dispatch = useCallback(async (action: ScheduleAction) => {
    const source = sourceRef.current
    if (!source) return

    // 1. Paint it now. A no-op action (the reducer's own early returns) leaves
    //    `db` untouched, exactly as it did when this waited for the server.
    pendingRef.current = [...pendingRef.current, action]
    setPending(pendingRef.current.length)
    setDb((prev) => (prev ? reduce(prev, action, localContext()).db : prev))

    // 2. Send it, behind everything already sent.
    const run = chainRef.current.then(async () => {
      // Identity, not equality: the same object reference was pushed above, so
      // two identical-looking actions never clear each other's slot.
      const settle = () => {
        pendingRef.current = pendingRef.current.filter((a) => a !== action)
        setPending(pendingRef.current.length)
      }
      try {
        const server = await source.dispatch(action)
        confirmedRef.current = server
        settle()
        setDb(replay(server, pendingRef.current))
      } catch (err) {
        settle()
        const base = confirmedRef.current
        if (base) setDb(replay(base, pendingRef.current))
        setWriteError(err instanceof Error ? err.message : String(err))
      }
    })
    chainRef.current = run
    return run
  }, [localContext, replay])

  const refresh = useCallback(async () => {
    const source = sourceRef.current
    if (!source) return
    const server = await source.refresh()
    confirmedRef.current = server
    // A poll must not undo an edit made a half-second ago that the server has
    // not answered for yet.
    setDb(replay(server, pendingRef.current))
  }, [replay])

  const resetDemo = useCallback(async () => {
    const source = sourceRef.current
    if (!source || !(source instanceof MockShiftsSource)) return
    clearPersisted()
    pendingRef.current = []
    setPending(0)
    const fresh = await source.reset()
    confirmedRef.current = fresh
    setDb(fresh)
  }, [])

  const viewer = useMemo<Viewer>(() => {
    const onRoster = db?.staff.find((s) => s.id === (viewAs ?? access.id))
    return {
      staffId: onRoster?.id ?? viewAs ?? fallbackStaffId ?? null,
      name: onRoster?.name ?? actorName,
      canManage: canManageSchedule(access, db?.settings ?? null),
      canDelegate: canDelegateSchedule(access),
    }
  }, [db, viewAs, access, actorName, fallbackStaffId])

  const value = useMemo<ShiftsContext | null>(() => {
    if (!db) return null
    return {
      db, lang, setLang,
      t: (key) => translate(key, lang),
      tri: (value) => value[lang] || value.he || value.en,
      viewer,
      setViewerStaffId: setViewAs,
      dispatch, refresh, resetDemo, pending,
      isMock: sourceRef.current?.isMock ?? true,
      today: todayIn(db.venue.timezone),
    }
  }, [db, lang, setLang, viewer, dispatch, refresh, resetDemo, pending])

  if (!value) return <ScheduleSkeleton />

  return (
    <Ctx.Provider value={value}>
      {children}
      <WriteErrorToast
        message={writeError}
        label={translate('saveFailed', lang)}
        dismiss={translate('close', lang)}
        onClose={() => setWriteError(null)}
      />
    </Ctx.Provider>
  )
}

/** A write that the server refused. The optimistic edit has already been
 *  rolled back by the time this appears — this exists so the rollback is
 *  explained rather than mysterious. Not auto-dismissed: a schedule edit that
 *  silently did not happen is exactly the thing worth reading. */
function WriteErrorToast({ message, label, dismiss, onClose }: {
  message: string | null
  label: string
  dismiss: string
  onClose: () => void
}) {
  if (!message) return null
  return (
    <div
      role="alert"
      style={{
        position: 'fixed', insetInline: 12, bottom: 'calc(env(safe-area-inset-bottom) + 14px)',
        zIndex: 300, maxWidth: 460, marginInline: 'auto',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        padding: '11px 13px', borderRadius: 14,
        border: '1px solid rgba(255,107,107,0.4)', background: 'rgba(38,18,18,0.96)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        boxShadow: '0 12px 34px rgba(0,0,0,0.45)',
        animation: 'sheet-up .28s var(--ease)',
      }}
    >
      <span aria-hidden>⚠️</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', fontSize: '0.85rem', color: '#ff9b9b' }}>{label}</strong>
        <span style={{
          display: 'block', marginTop: 2, fontSize: '0.72rem', lineHeight: 1.5,
          color: 'var(--text-dim)', overflowWrap: 'anywhere',
        }}>
          {message}
        </span>
      </span>
      <button
        type="button" onClick={onClose} aria-label={dismiss} className="press"
        style={{
          flex: '0 0 auto', width: 26, height: 26, borderRadius: 999, border: 'none',
          background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)',
          font: 'inherit', cursor: 'pointer', lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  )
}

/** Matches the shape of the loaded week so the swap is not a layout jump —
 *  the same trick the owner and menu routes use in their loading.tsx. */
function ScheduleSkeleton() {
  return (
    <div style={{ padding: '20px 16px', maxWidth: 1180, margin: '0 auto' }} aria-busy="true">
      <div className="sk" style={{ height: 44, borderRadius: 14, marginBottom: 14 }} />
      <div className="sk" style={{ height: 38, borderRadius: 12, marginBottom: 14 }} />
      <div className="sh-week">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="sk" style={{ height: 170, borderRadius: 16 }} />
        ))}
      </div>
    </div>
  )
}
