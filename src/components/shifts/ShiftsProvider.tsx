'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import { canDelegateSchedule, canManageSchedule, type ScheduleAccessRow } from '@/lib/shifts/access'
import { MockShiftsSource, clearPersisted } from '@/lib/shifts/mock'
import { t as translate, type StringKey } from '@/lib/shifts/i18n'
import { todayIn } from '@/lib/shifts/time'
import type { ShiftsDataSource } from '@/lib/shifts/adapter'
import type { ScheduleAction, ShiftsDB } from '@/lib/shifts/store'
import type { Lang, Tri } from '@/lib/shifts/types'

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

  useEffect(() => {
    const source = new MockShiftsSource({ id: access.id ?? null, name: actorName })
    sourceRef.current = source
    source.load().then(setDb)
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
    setDb(await source.dispatch(action))
  }, [])

  const resetDemo = useCallback(async () => {
    const source = sourceRef.current
    if (!source || !(source instanceof MockShiftsSource)) return
    clearPersisted()
    setDb(await source.reset())
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
      dispatch, resetDemo,
      isMock: sourceRef.current?.isMock ?? true,
      today: todayIn(db.venue.timezone),
    }
  }, [db, lang, setLang, viewer, dispatch, resetDemo])

  if (!value) return <ScheduleSkeleton />

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
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
