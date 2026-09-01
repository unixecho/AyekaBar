'use client'

import { useCallback, useEffect, useRef } from 'react'
import ModalPortal from '@/components/ModalPortal'

// The bottom sheet the cart's overlays share.
//
// Built on the app's existing `.sheet-scrim` / `.sheet-panel` classes — the
// same shell VariantWizard and HappyHourWizard already use, so a customer sheet
// and an owner sheet look like the same product — plus the dialog behaviour
// those two never needed and this one does:
//
//   • A REAL FOCUS TRAP. `ConfirmSheet`/`PromptSheet` set body overflow and
//     focus one control, which is enough for a two-button dialog; the cart
//     sheet has dozens of controls behind a scrim, and a keyboard or
//     screen-reader user tabbing straight out of it into the menu underneath —
//     which is still there, still focusable, and visually obscured — is a WCAG
//     2.4.3 failure. PLAN_MENU_CART §6 asked for this; ModalPortal alone does
//     NOT provide it (it only relocates the DOM), so it is implemented here.
//   • Focus RESTORED to whatever opened the sheet when it closes.
//   • Escape closes. Clicking the scrim closes; clicking the panel does not.
//
// `suspended` is what makes it safe to open a `PromptSheet`/`ConfirmSheet` ON
// TOP of this one. Those two render into their own portal at a higher z-index
// and run their own Escape handler; without handing the keyboard over, this
// shell's capturing listener would swallow Escape and close the CART instead
// of the little dialog the customer is actually looking at. Whoever opens a
// nested overlay sets `suspended` for as long as it is up.
//
// Scroll lock is `overflow: hidden` on <body>, matching the rest of the app.
// Deliberately not the `position: fixed` variant — that one scrolls iOS back
// to the top of the page on release, which for a customer halfway down a long
// menu is worse than the background scroll-chaining it prevents.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function SheetShell({
  open, onClose, label, children, footer, dir, suspended = false,
}: {
  open: boolean
  onClose: () => void
  /** Accessible name for the dialog. */
  label: string
  children: React.ReactNode
  /** Rendered outside the scrolling area, pinned to the bottom of the panel. */
  footer?: React.ReactNode
  dir: 'rtl' | 'ltr'
  /** True while a nested overlay owns the keyboard. */
  suspended?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  const focusables = useCallback((): HTMLElement[] => {
    const panel = panelRef.current
    if (!panel) return []
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      // A control scrolled out of view is still reachable; one that is
      // display:none is not, and offsetParent is the cheap way to tell.
      .filter((el) => el.offsetParent !== null || el === document.activeElement)
  }, [])

  // Scroll lock + initial focus + focus restore. Keyed only on `open` so that
  // suspending for a nested dialog does not re-lock, re-focus or re-run any
  // of it.
  useEffect(() => {
    if (!open) return

    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // One frame's delay: the panel is mid-animation on the first paint, and
    // focusing it immediately makes iOS scroll the sheet before it has landed.
    const t = window.setTimeout(() => {
      const list = focusables()
      ;(list[0] ?? panelRef.current)?.focus()
    }, 60)

    return () => {
      document.body.style.overflow = prevOverflow
      window.clearTimeout(t)
      // Only take focus back if it is still inside this sheet (or nowhere) —
      // if something else deliberately claimed it, leave it alone.
      const active = document.activeElement
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        returnFocusTo.current?.focus?.()
      }
    }
  }, [open, focusables])

  // Escape + Tab wrapping, handed over entirely while a nested overlay is up.
  useEffect(() => {
    if (!open || suspended) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!panelRef.current?.contains(active)
      // Wrap at both ends, and pull focus back in if it has escaped (clicking
      // the scrim leaves activeElement on <body>).
      if (e.shiftKey) {
        if (active === first || !inside) { e.preventDefault(); last.focus() }
      } else if (active === last || !inside) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, suspended, onClose, focusables])

  if (!open) return null

  return (
    <ModalPortal>
      <div className="sheet-scrim" onClick={onClose} dir={dir}>
        <div
          ref={panelRef}
          className="sheet-panel"
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sheet-grabber" aria-hidden />
          {children}
          {footer}
        </div>
      </div>
    </ModalPortal>
  )
}
