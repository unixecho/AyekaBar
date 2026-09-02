'use client'

import { useEffect, useRef } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { haptic } from '@/lib/haptics'
import { RTL, type Lang } from '@/lib/menu/types'
import { CART_UI } from '@/lib/cart/i18n'
import { useCart } from './CartProvider'

// The one-time walkthrough, shown the first time something lands in the cart.
//
// ── WHY A PAUSE AND NOT A TOOLTIP ───────────────────────────────────
// "a big pause notification with blurry background to explain to the user
// what to do with the cart... kinda like a tutorial" (2026-09-02). The cart
// introduces three things a customer has no reason to expect from a menu:
// that the order persists while they browse, that it can be split between
// people by name, and that the end state is showing a screen to a waiter
// rather than reciting anything. A tooltip on a floating button explains the
// button. It does not explain any of that.
//
// It is shown on the FIRST ADD, not on arrival — see addToCart in
// CartProvider. And the floating button is deliberately still absent while
// this is up: closing the walkthrough is what summons it, so the customer is
// looking at the corner at the exact moment something appears there.
//
// ── ONCE PER DEVICE, FOREVER ────────────────────────────────────────
// The flag lives under its own localStorage key rather than inside the cart,
// because the cart expires after eight hours and is cleared when emptied —
// neither of which is a reason to re-teach the same person. See
// CART_TUTORIAL_KEY.
//
// ── THE BLUR IS ON A STATIC LAYER ───────────────────────────────────
// House rule (CLAUDE.md): never animate an element carrying a
// backdrop-filter — the blur is recomputed over the whole viewport on every
// frame. The scrim here holds the blur and does not move; the card is a
// sibling that animates. Same split `shifts/SheetShell.tsx` uses.

export default function CartTutorial({ lang }: { lang: Lang }) {
  const { tutorialOpen, dismissTutorial } = useCart()
  const cardRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLButtonElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  // Focus in, focus back out, and a real trap while it is up. This is a modal
  // over a long scrollable menu: without the trap a keyboard or screen-reader
  // user tabs straight into the menu behind the blur, which is still there
  // and still focusable. Same reasoning as SheetShell's own trap.
  useEffect(() => {
    if (!tutorialOpen) return

    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const t = window.setTimeout(() => ctaRef.current?.focus(), 80)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismissTutorial(); return }
      if (e.key !== 'Tab') return
      // One meaningful control, so the trap is simply "stay on it".
      const cta = ctaRef.current
      if (!cta) return
      e.preventDefault()
      cta.focus()
    }
    document.addEventListener('keydown', onKey, true)

    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      window.clearTimeout(t)
      const active = document.activeElement
      if (!active || active === document.body || cardRef.current?.contains(active)) {
        returnFocusTo.current?.focus?.()
      }
    }
  }, [tutorialOpen, dismissTutorial])

  if (!tutorialOpen) return null

  const dir = RTL[lang] ? 'rtl' : 'ltr'

  return (
    <ModalPortal>
      <div className="cart-tut-scrim" dir={dir}>
        <div
          ref={cardRef}
          className="cart-tut-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cart-tut-title"
          tabIndex={-1}
        >
          <div className="cart-tut-glyph pop" aria-hidden>🧾</div>

          <h2 id="cart-tut-title" className="cart-tut-title">
            {CART_UI.tutorialTitle[lang]}
          </h2>

          {/* Three points, each tied to a place on the screen the customer is
              about to look at. Ordered the way they will meet them: the thing
              that just appeared, the thing at the top, the thing at the end. */}
          <ul className="cart-tut-list">
            <li className="cart-tut-item" style={{ animationDelay: '120ms' }}>
              <span className="cart-tut-icon" aria-hidden>🛒</span>
              <span>{CART_UI.tutorialCart[lang]}</span>
            </li>
            <li className="cart-tut-item" style={{ animationDelay: '200ms' }}>
              <span className="cart-tut-icon" aria-hidden>👥</span>
              <span>{CART_UI.tutorialSplit[lang]}</span>
            </li>
            <li className="cart-tut-item" style={{ animationDelay: '280ms' }}>
              <span className="cart-tut-icon" aria-hidden>🙋</span>
              <span>{CART_UI.tutorialShow[lang]}</span>
            </li>
          </ul>

          <p className="cart-tut-privacy">{CART_UI.tutorialPrivacy[lang]}</p>

          <button
            ref={ctaRef}
            type="button"
            className="cart-tut-cta press"
            onClick={() => { haptic('select'); dismissTutorial() }}
          >
            {CART_UI.tutorialCta[lang]}
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}
