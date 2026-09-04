'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'

// One language switcher for the whole site. The portal, menu and team page
// each had their own — a globe with a dropdown, a globe with CSS-class styling,
// and a plain text button that cycled — so the control changed shape as you
// moved between pages. This is the single implementation.
//
// Stays pinned to the same PHYSICAL corner in RTL and LTR (project rule), and
// the dropdown is a styled panel, never a native <select>.

export type Lang = 'he' | 'en' | 'ar'

export const LANG_NAMES: Record<Lang, string> = {
  he: 'עברית',
  en: 'English',
  ar: 'العربية',
}

const ORDER: Lang[] = ['he', 'en', 'ar']

// A11y (WCAG 3.1.2 Language of Parts): was a hardcoded "Language" — every
// other user-facing string in the app is trilingual per house convention,
// this one was missed. Announced in whichever language is CURRENTLY
// active, matching how a screen reader is already reading the rest of
// the page at the moment it reaches this control.
const TRIGGER_LABEL: Record<Lang, string> = {
  he: 'שינוי שפה', en: 'Change language', ar: 'تغيير اللغة',
}

export default function LanguageSwitch({
  lang,
  onChange,
  variant = 'fixed',
}: {
  lang: Lang
  onChange: (next: Lang) => void
  /** `fixed` pins to the viewport corner; `inline` sits in a topbar. */
  variant?: 'fixed' | 'inline'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // A11y (WCAG 2.4.3): none of the three ways to dismiss this dropdown
  // (outside click, Escape, picking a language) ever returned focus to the
  // trigger — found 2026-09-04. The trigger button is never conditionally
  // rendered, so — unlike ConfirmSheet/PromptSheet's "capture whatever was
  // focused, restore it" — this can just focus the trigger directly on
  // every dismissal path, since that trigger is realistically what had
  // focus before the menu opened in every real case (a click on it, or a
  // Tab-then-Enter/Space to it).
  const closeAndReturnFocus = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Close on outside click — must check containment, not just "any click",
  // or the click that OPENS the menu closes it again in the same tick.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAndReturnFocus() }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [closeAndReturnFocus])

  const wrap: CSSProperties = variant === 'fixed'
    ? { position: 'fixed', left: 14, top: 'calc(env(safe-area-inset-top) + 14px)', zIndex: 50 }
    : { position: 'relative', zIndex: 30 }

  return (
    <div ref={ref} style={wrap}>
      <button
        ref={triggerRef}
        aria-label={TRIGGER_LABEL[lang]} aria-expanded={open} aria-haspopup="menu"
        className="press"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        style={{
          // A11y backlog A5 (WCAG 2.2 2.5.8 Target Size Minimum): was 38x38.
          width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 12,
          border: `1px solid ${open ? 'var(--neon-2)' : 'var(--line)'}`,
          background: open ? 'rgba(56,225,255,0.06)' : 'rgba(255,255,255,0.02)',
          color: 'var(--text)', cursor: 'pointer',
          boxShadow: open ? '0 0 18px rgba(56,225,255,0.4)' : 'none',
          transition: 'border-color .2s var(--ease), box-shadow .2s var(--ease)',
        }}
      >
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor"
          strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
          <path d="M12 3c2.5 2.5 3.8 5.8 3.8 9S14.5 18.5 12 21C9.5 18.5 8.2 15.2 8.2 12S9.5 5.5 12 3z" />
        </svg>
      </button>

      {open && (
        <div role="menu" style={{
          // top: 52, not 46 — keeps the same ~8px gap now the button is 44px tall (was 38).
          position: 'absolute', top: 52, left: 0, minWidth: 132,
          background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)',
          borderRadius: 14, padding: 6, boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column', gap: 2,
          animation: 'rise-in .22s var(--ease)',
        }}>
          {ORDER.map((l) => {
            const active = l === lang
            return (
              <button
                key={l} role="menuitem" onClick={() => { onChange(l); closeAndReturnFocus() }}
                style={{
                  border: 0, background: active ? 'rgba(255,94,58,0.14)' : 'transparent',
                  boxShadow: active ? 'inset 0 0 0 1px rgba(255,94,58,0.3)' : 'none',
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                  textAlign: 'start', font: 'inherit', fontWeight: 500,
                  // A11y backlog A5 (WCAG 2.2 2.5.8): was 9px 12px padding,
                  // ~37px tall — found live-testing, not in the original
                  // audit's file list.
                  padding: '9px 12px', minHeight: 44, boxSizing: 'border-box',
                  display: 'flex', alignItems: 'center', width: '100%',
                  borderRadius: 10, cursor: 'pointer',
                }}
              >
                {LANG_NAMES[l]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Shared persistence + <html> sync, so every page treats language identically. */
export function useLanguage(): [Lang, (next: Lang) => void] {
  const [lang, setLang] = useState<Lang>('he')

  useEffect(() => {
    const saved = localStorage.getItem('siteLanguage')
    if (saved && (ORDER as string[]).includes(saved)) setLang(saved as Lang)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl'
  }, [lang])

  return [lang, (next: Lang) => { setLang(next); localStorage.setItem('siteLanguage', next) }]
}
