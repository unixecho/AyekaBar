'use client'

import { useEffect, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'

// A pointer-follow reading mask: a lit horizontal band that tracks the
// cursor, with everything above and below dimmed via a box-shadow spread —
// the standard CSS "spotlight" technique, not two separate overlay divs.
//
// Mounted only while the preference is on (App.tsx-level conditional, not a
// CSS visibility toggle) so a visitor who never turns this on pays nothing —
// no pointermove listener, no portal, no paint cost.
//
// `pointer-events: none` throughout: this is a visual aid, never something
// a click can land on, and it must never sit between a visitor's tap and the
// control underneath it.

const HEIGHT = 64

export default function ReadingGuide() {
  const [y, setY] = useState<number | null>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent) => setY(e.clientY)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  if (y === null) return null

  return (
    <ModalPortal>
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          top: y - HEIGHT / 2,
          height: HEIGHT,
          pointerEvents: 'none',
          zIndex: 2147483000,
          background: 'rgba(255, 255, 255, 0.05)',
          borderTop: '2px solid var(--a11y-accent, var(--neon, #ff5e3a))',
          borderBottom: '2px solid var(--a11y-accent, var(--neon, #ff5e3a))',
          // The spotlight: a shadow spread tall enough to cover the rest of
          // the viewport above and below the lit band, in both directions.
          boxShadow: '0 -100vh 0 100vh rgba(0,0,0,0.55), 0 100vh 0 100vh rgba(0,0,0,0.55)',
        }}
      />
    </ModalPortal>
  )
}
