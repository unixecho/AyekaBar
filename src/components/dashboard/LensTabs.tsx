'use client'

import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { haptic } from '@/lib/haptics'
import { LENSES, type Lens } from '@/lib/dashboard/lens'

// The developer's three views in ONE perspective (2026-10-15): manager · employee · developer.
//
// The panels are server-rendered by the page and passed in; only the ACTIVE one is mounted, so the manager view's
// 30-second live polling (DashboardLive) runs only while that view is open, never behind the others. The chosen view
// lives in the URL (`?view=`), written with replaceState: a refresh keeps it, a shared link opens on it, and nothing
// is stored on the device — so there is no storage key to declare (lib/privacy/registry.ts).
//
// It is a proper tablist (arrow keys, Home/End, roving tabindex) because it is the page's main navigation.

export default function LensTabs({ initial, panels }: { initial: Lens; panels: Record<Lens, ReactNode> }) {
  const [lens, setLens] = useState<Lens>(initial)
  const refs = useRef<Record<Lens, HTMLButtonElement | null>>({ manager: null, employee: null, dev: null })

  const choose = useCallback((next: Lens, focus = false) => {
    setLens(next)
    haptic('select')
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('view', next)
      window.history.replaceState(null, '', url)
    } catch { /* the view still switches; only the refresh-keeps-it nicety is lost */ }
    if (focus) refs.current[next]?.focus()
  }, [])

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const at = LENSES.findIndex((l) => l.id === lens)
    // The row is RTL, so the first lens sits on the RIGHT: ArrowRight goes to the previous one, ArrowLeft to the next.
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? 1 : 0
    if (step !== 0) { e.preventDefault(); choose(LENSES[(at + step + LENSES.length) % LENSES.length]!.id, true) }
    else if (e.key === 'Home') { e.preventDefault(); choose(LENSES[0]!.id, true) }
    else if (e.key === 'End') { e.preventDefault(); choose(LENSES[LENSES.length - 1]!.id, true) }
  }

  return (
    <>
      <div role="tablist" aria-label="תצוגות" onKeyDown={onKey} style={rowStyle}>
        {LENSES.map((l) => {
          const on = l.id === lens
          return (
            <button
              key={l.id} ref={(el) => { refs.current[l.id] = el }} type="button" role="tab" id={`lens-tab-${l.id}`}
              aria-selected={on} aria-controls={`lens-panel-${l.id}`} tabIndex={on ? 0 : -1}
              className="press" onClick={() => choose(l.id)}
              style={{
                flex: 1, minHeight: 44, padding: '8px 6px', borderRadius: 11, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: '0.84rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                color: on ? 'var(--bg)' : 'var(--text-dim)',
                background: on ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))' : 'transparent',
                transition: 'background .25s var(--ease), color .25s var(--ease)',
              }}
            >
              <span aria-hidden>{l.icon}</span>{l.he}
            </button>
          )
        })}
      </div>

      <div key={lens} role="tabpanel" id={`lens-panel-${lens}`} aria-labelledby={`lens-tab-${lens}`} tabIndex={-1}
        className="rise" style={{ display: 'flex', flexDirection: 'column', gap: 20, outline: 'none' }}>
        {panels[lens]}
      </div>
    </>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex', gap: 4, padding: 4, borderRadius: 15, background: 'var(--bg-elev)', border: '1px solid var(--line)',
  position: 'sticky', top: 8, zIndex: 20,
}
