'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'

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

  // Close on outside click — must check containment, not just "any click",
  // or the click that OPENS the menu closes it again in the same tick.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const wrap: CSSProperties = variant === 'fixed'
    ? { position: 'fixed', left: 14, top: 'calc(env(safe-area-inset-top) + 14px)', zIndex: 50 }
    : { position: 'relative', zIndex: 30 }

  return (
    <div ref={ref} style={wrap}>
      <button
        aria-label="Language" aria-expanded={open} aria-haspopup="menu"
        className="press"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        style={{
          width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 12,
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
          position: 'absolute', top: 46, left: 0, minWidth: 132,
          background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)',
          borderRadius: 14, padding: 6, boxShadow: '0 18px 40px rgba(0,0,0,0.55)',
          display: 'flex', flexDirection: 'column', gap: 2,
          animation: 'rise-in .22s var(--ease)',
        }}>
          {ORDER.map((l) => {
            const active = l === lang
            return (
              <button
                key={l} role="menuitem" onClick={() => { onChange(l); setOpen(false) }}
                style={{
                  border: 0, background: active ? 'rgba(255,94,58,0.14)' : 'transparent',
                  boxShadow: active ? 'inset 0 0 0 1px rgba(255,94,58,0.3)' : 'none',
                  color: active ? 'var(--text)' : 'var(--text-dim)',
                  textAlign: 'start', font: 'inherit', fontWeight: 500,
                  padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
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
