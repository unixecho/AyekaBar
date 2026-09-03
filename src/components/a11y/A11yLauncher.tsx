'use client'

import ModalPortal from '@/components/ModalPortal'
import { useA11y } from './A11yProvider'
import { a11yT } from '@/lib/a11y/i18n'
import type { A11yCorner } from '@/lib/a11y/types'

// The trigger button. Portalled to <body> for the same reason CartFab.tsx
// documents at length: any ancestor with an active `transform` (every page's
// own entrance animation, per template.tsx) silently becomes this button's
// containing block, and `position: fixed` then resolves against the PAGE
// instead of the viewport.
//
// `corner` is a physical value, never logical start/end — the same house
// rule CartFab.tsx states: fixed chrome stays in the same physical corner
// regardless of text direction, so this must not flip meaning under RTL.

const CORNER_CLASS: Record<A11yCorner, string> = {
  'top-left': 'a11y-fab-tl',
  'top-right': 'a11y-fab-tr',
  'bottom-left': 'a11y-fab-bl',
  'bottom-right': 'a11y-fab-br',
}

export default function A11yLauncher({
  corner, open, onOpen,
}: {
  corner: A11yCorner
  open: boolean
  onOpen: () => void
}) {
  const { lang } = useA11y()

  return (
    <ModalPortal>
      <button
        type="button"
        className={`a11y-fab ${CORNER_CLASS[corner]} press`}
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={a11yT('openLabel', lang)}
      >
        <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor"
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v1M9 12h6M12 12v5" />
        </svg>
      </button>
    </ModalPortal>
  )
}
