'use client'

import './a11y.css'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { RTL, type Lang } from '@/lib/menu/types'
import { DEFAULT_A11Y_PREFS, type A11yPrefs } from '@/lib/a11y/types'
import { loadA11yPrefs, saveA11yPrefs } from '@/lib/a11y/storage'
import { computeAppliedState, ALL_A11Y_HTML_CLASSES } from '@/lib/a11y/apply'

// The widget's state + the one place it ever touches the DOM outside its
// own portalled UI. PLAN_ACCESSIBILITY.md §3.4 (focus neutrality, checked
// against the haptics.ts lesson): this effect only ever writes
// className/style — it has NO code path that calls .focus() on anything,
// which is the exact class of bug haptics.ts hit (an invisible element
// silently stealing keyboard focus on every call). Applying a preference
// must never move focus; nothing below does.

interface A11yContextValue {
  prefs: A11yPrefs
  ready: boolean
  set: <K extends keyof A11yPrefs>(key: K, value: A11yPrefs[K]) => void
  reset: () => void
  lang: Lang
  dir: 'rtl' | 'ltr'
}

const A11yContext = createContext<A11yContextValue | null>(null)

export function useA11y(): A11yContextValue {
  const ctx = useContext(A11yContext)
  if (!ctx) throw new Error('useA11y must be used inside <A11yProvider>')
  return ctx
}

export default function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<A11yPrefs>(DEFAULT_A11Y_PREFS)
  const [ready, setReady] = useState(false)
  const [lang, setLang] = useState<Lang>('he')

  // Client-only load, same hydration-safety reasoning as the cart's own
  // `ready` gate (AddToCartControl.tsx): rendering a preference that then
  // jumps on first paint is worse than rendering the default for one frame.
  useEffect(() => {
    setPrefsState(loadA11yPrefs())
    setReady(true)
  }, [])

  useEffect(() => {
    if (ready) saveA11yPrefs(prefs)
  }, [prefs, ready])

  // Track <html lang>, which Portal.tsx / MenuView.tsx each already sync on
  // every language change. A MutationObserver rather than a shared context:
  // no app-wide language context exists in this codebase (every trilingual
  // page manages its own `lang` state independently), and this widget
  // mounts site-wide — including on Hebrew-only owner/staff pages, where it
  // should just read Hebrew and stay quiet.
  useEffect(() => {
    const read = () => {
      const l = document.documentElement.lang
      if (l === 'he' || l === 'en' || l === 'ar') setLang(l)
    }
    read()
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    return () => obs.disconnect()
  }, [])

  const dir: 'rtl' | 'ltr' = RTL[lang] ? 'rtl' : 'ltr'

  // Apply to the DOM. Diffed against the full known class list so a class
  // that is no longer wanted is actually removed, not merely never re-added.
  useEffect(() => {
    const html = document.documentElement
    const { htmlVars, htmlClasses, scopeFilter } = computeAppliedState(prefs)
    Object.entries(htmlVars).forEach(([k, v]) => html.style.setProperty(k, v))
    html.classList.remove(...ALL_A11Y_HTML_CLASSES)
    if (htmlClasses.length) html.classList.add(...htmlClasses)
    // #a11y-scope wraps {children} in layout.tsx — see apply.ts's own header
    // for why `filter` is scoped there and never applied to <html>/<body>.
    const scope = document.getElementById('a11y-scope')
    if (scope) scope.style.filter = scopeFilter === 'none' ? '' : scopeFilter
  }, [prefs])

  const set = useCallback(<K extends keyof A11yPrefs>(key: K, value: A11yPrefs[K]) => {
    setPrefsState((prev) => ({ ...prev, [key]: value }))
  }, [])
  const reset = useCallback(() => setPrefsState({ ...DEFAULT_A11Y_PREFS }), [])

  const value = useMemo(
    () => ({ prefs, ready, set, reset, lang, dir }),
    [prefs, ready, set, reset, lang, dir],
  )

  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>
}
