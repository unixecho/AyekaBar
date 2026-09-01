'use client'

import { useEffect, useRef, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import { haptic } from '@/lib/haptics'
import { RTL, type Lang } from '@/lib/menu/types'
import { cartCount, cartTotals } from '@/lib/cart/store'
import { fmtAgorot } from '@/lib/cart/variants'
import { CART_UI } from '@/lib/cart/i18n'
import { useCart } from './CartProvider'

// The button that isn't there until it is.
//
// ⚠️ IT IS PORTALLED TO <body>, AND IT HAS TO BE. `position: fixed` is only
// resolved against the viewport while NO ancestor carries a transform, filter
// or perspective — any of those silently become the element's containing
// block. `src/app/template.tsx` gives every page a `.page-enter` entrance that
// animates `translateX` with `animation-fill-mode: both`, so the transform is
// still applied after it finishes and that ancestor stays a containing block
// for the life of the page. Rendered in the tree, this button computed to
// `bottom: 16px` and landed at y≈2619 on an 812px-tall viewport — off-screen,
// pinned to the bottom of the whole menu instead of the bottom of the screen.
// ModalPortal exists for exactly this (read its own header); the cart sheet
// gets it via SheetShell, and the floating button needs it for the same
// reason. Found by measuring, not by reading — see HANDOFF 2026-09-01.
//
// THREE MORE THINGS THAT LOOK LIKE DETAILS AND ARE NOT:
//
// 1. It renders from the first paint and is merely INVISIBLE until summoned —
//    it is not conditionally mounted. The fly-to-cart animation measures this
//    wrapper to know where to fly TO, and on the very first add the button has
//    not been summoned yet. A conditionally-mounted button has no rect on the
//    one occasion the animation most needs one.
// 2. Hidden means `opacity: 0`, never a transform. A scaled box measures its
//    scaled size, which would land the first chip in the wrong place. The
//    spring goes on the inner button at summon time instead.
// 3. Once summoned it never hides again, even when the cart empties back to
//    zero — a control that appears and disappears as the last item comes and
//    goes reads as the page glitching, not as a cart being empty.

export default function CartFab({ lang }: { lang: Lang }) {
  const { cart, ready, summoned, openSheet, registerFab, bumpKey } = useCart()
  const [popping, setPopping] = useState(false)
  const [bumping, setBumping] = useState(false)
  const wasSummoned = useRef(false)

  // The spring plays exactly once, on the transition from absent to present.
  useEffect(() => {
    if (summoned && !wasSummoned.current) {
      wasSummoned.current = true
      setPopping(true)
      const t = window.setTimeout(() => setPopping(false), 600)
      return () => window.clearTimeout(t)
    }
    if (summoned) wasSummoned.current = true
  }, [summoned])

  // Something arrived. For a reduced-motion visitor this pulse IS the
  // feedback — there was no flight to watch.
  useEffect(() => {
    if (bumpKey === 0) return
    setBumping(true)
    const t = window.setTimeout(() => setBumping(false), 340)
    return () => window.clearTimeout(t)
  }, [bumpKey])

  const count = cartCount(cart)
  const { agorot, unpricedLines } = cartTotals(cart)

  // Nothing at all before hydration: the server has no idea what is in this
  // phone's cart, and rendering a button with "0" that then jumps to "4" is
  // both a hydration mismatch and a flicker.
  if (!ready) return null

  return (
    <ModalPortal>
      <div
        ref={registerFab}
        className="cart-fab-wrap"
        data-summoned={summoned}
        data-pop={popping}
        // Out of the accessibility tree AND out of the tab order while it is
        // invisible — `opacity: 0` alone leaves a button a keyboard user can
        // focus and a screen reader will happily announce.
        aria-hidden={!summoned}
        // The physical corner, regardless of text direction (house rule) — but
        // the button's own contents are laid out for the reading direction.
        dir={RTL[lang] ? 'rtl' : 'ltr'}
      >
        <button
          type="button"
          className="cart-fab press"
          onClick={() => { haptic('select'); openSheet() }}
          tabIndex={summoned ? 0 : -1}
          aria-label={`${CART_UI.open[lang]} — ${count} ${CART_UI.inCart[lang]}`}
        >
          <svg className="cart-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6" />
            <circle cx="10" cy="20" r="1.2" />
            <circle cx="18" cy="20" r="1.2" />
          </svg>
          <span className="cart-fab-total" dir="ltr">
            {agorot > 0 || unpricedLines === 0 ? `${fmtAgorot(agorot)}₪` : '—'}
          </span>
          <span className="cart-fab-badge" data-bump={bumping} aria-hidden>{count}</span>
        </button>
      </div>
    </ModalPortal>
  )
}
