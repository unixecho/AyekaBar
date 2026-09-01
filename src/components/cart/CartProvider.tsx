'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import type { Lang } from '@/lib/menu/types'
import { haptic } from '@/lib/haptics'
import { EMPTY_CART, type Cart } from '@/lib/cart/types'
import { reduce, type AddPayload, type CartAction } from '@/lib/cart/store'
import { loadCart, saveCart, clearCart as clearStored } from '@/lib/cart/storage'
import './cart.css'

// The one stateful piece of the cart. Everything it decides, it decides by
// calling `lib/cart/store.ts` — this file owns persistence, the DOM effects
// (the flight, the button's summoning) and nothing else. That split is why the
// rules can be tested headless in `scripts/check-cart.mjs`.

export interface CartActionAvailability {
  /** Phase 2 — "שליחה למלצר". */
  ordering: boolean
  /** Phase 3 — "קריאה למלצר". */
  call: boolean
}

interface CartContextValue {
  /** False until localStorage has been read. Nothing that depends on the
   *  cart's contents may render before this flips, or the server HTML and the
   *  first client render disagree and React throws a hydration error. */
  ready: boolean
  cart: Cart
  lang: Lang
  /** Has the button been called into existence? Once true, stays true. */
  summoned: boolean
  /** Who new items are added for. null = "לשולחן". */
  activeDinerId: string | null
  setActiveDinerId: (id: string | null) => void
  /** Returns the NEW cart, or null when the reducer refused the action (at a
   *  cap, a duplicate diner name, a line that no longer exists). Callers that
   *  need the thing they just created — the id of a diner the reducer minted,
   *  say — read it off the returned cart; there is no other way to get it,
   *  and re-reading `cart` in the same handler would still be the old one. */
  dispatch: (action: CartAction) => Cart | null
  /** Add + summon + fly + haptic, in the right order. `from` is the rect of
   *  the control that was tapped; omit it to skip the flight. */
  addToCart: (payload: AddPayload, from?: DOMRect | null, label?: string) => void
  clearAll: () => void
  sheetOpen: boolean
  openSheet: () => void
  closeSheet: () => void
  /** The FAB registers its (never-transformed) wrapper here so the flight
   *  knows where to land. */
  registerFab: (el: HTMLElement | null) => void
  /** Increments whenever something arrived — the badge pulses on it. Also the
   *  entire feedback for a reduced-motion visitor, who gets no flight. */
  bumpKey: number
  actions: CartActionAvailability
}

const CartContext = createContext<CartContextValue | null>(null)

/** Reading the cart outside its provider is a wiring mistake, not a runtime
 *  condition to handle — fail loudly in development rather than silently
 *  rendering a cart that can never fill. */
export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart() outside <CartProvider>')
  return ctx
}

const FLY_MS = 560
const SAVE_DEBOUNCE_MS = 200

export default function CartProvider({
  lang, actions, children,
}: {
  lang: Lang
  actions: CartActionAvailability
  children: React.ReactNode
}) {
  const [cart, setCart] = useState<Cart>(EMPTY_CART)
  const [ready, setReady] = useState(false)
  const [summoned, setSummoned] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeDinerId, setActiveDinerId] = useState<string | null>(null)
  const [bumpKey, setBumpKey] = useState(0)

  // Mirror of `cart`, so a handler can read the CURRENT cart, apply the
  // reducer and know whether anything actually changed — all before React has
  // re-rendered. Without it, two taps in the same frame would both reduce the
  // same stale cart and the second would be lost.
  const cartRef = useRef<Cart>(EMPTY_CART)
  const fabRef = useRef<HTMLElement | null>(null)

  // ── Hydration ───────────────────────────────────────────────────────
  // In an effect, never during render: localStorage does not exist on the
  // server, and a cart read during render would make the first client paint
  // differ from the server's.
  useEffect(() => {
    const restored = loadCart()
    cartRef.current = restored.cart
    setCart(restored.cart)
    setSummoned(restored.summoned || restored.cart.lines.length > 0)
    setReady(true)
  }, [])

  // ── Persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return
    const id = window.setTimeout(() => saveCart(cart, summoned), SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [cart, summoned, ready])

  // A diner who was removed must stop being the one new items are added for,
  // or the next tap silently lands on the table with no explanation.
  useEffect(() => {
    if (activeDinerId && !cart.diners.some((d) => d.id === activeDinerId)) {
      setActiveDinerId(null)
    }
  }, [cart.diners, activeDinerId])

  const dispatch = useCallback((action: CartAction): Cart | null => {
    const next = reduce(cartRef.current, action)
    // The reducer returns its input by reference when it declined to act, so
    // identity is the refusal signal — no second "did it work" return value to
    // keep in sync with the rules.
    if (next === cartRef.current) return null
    cartRef.current = next
    setCart(next)
    return next
  }, [])

  const clearAll = useCallback(() => {
    cartRef.current = EMPTY_CART
    setCart(EMPTY_CART)
    setActiveDinerId(null)
    clearStored()
    // `summoned` deliberately survives a clear: the button was called into
    // existence by a real add, and having it vanish mid-visit reads as the
    // page breaking rather than as the cart being empty.
  }, [])

  const registerFab = useCallback((el: HTMLElement | null) => {
    fabRef.current = el
  }, [])

  /** The chip that flies from the tapped control into the button. Built as a
   *  plain DOM node rather than React state: it is a fire-and-forget visual
   *  with no lifecycle worth re-rendering the page for, and three taps in a
   *  second should produce three chips, not a queue. */
  const fly = useCallback((from: DOMRect, label: string) => {
    if (typeof document === 'undefined') return
    const target = fabRef.current?.getBoundingClientRect()
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const el = document.createElement('div')
    // No flight for a reduced-motion visitor, and none if we somehow have no
    // destination — but the badge still pulses, because "nothing happened" is
    // the one response a tap must never get.
    if (reduceMotion || !target || typeof el.animate !== 'function') {
      setBumpKey((n) => n + 1)
      return
    }

    el.className = 'cart-fly'
    el.textContent = label
    el.setAttribute('aria-hidden', 'true')
    el.style.left = `${from.left}px`
    el.style.top = `${from.top}px`
    document.body.appendChild(el)

    const rect = el.getBoundingClientRect()
    const dx = target.left + target.width / 2 - (rect.left + rect.width / 2)
    const dy = target.top + target.height / 2 - (rect.top + rect.height / 2)

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      el.remove()
      setBumpKey((n) => n + 1)
    }

    const anim = el.animate(
      [
        { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
        // An arc, not a straight line: the chip rises before it falls into the
        // button, which is what makes it read as thrown rather than dragged.
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 46}px) scale(0.86)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.22)`, opacity: 0 },
      ],
      { duration: FLY_MS, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' },
    )
    anim.onfinish = cleanup
    anim.oncancel = cleanup
    // Belt and braces: a tab backgrounded mid-flight can leave an animation
    // that never finishes, and an orphaned fixed-position chip would sit on
    // the page forever.
    window.setTimeout(cleanup, FLY_MS + 400)
  }, [])

  const addToCart = useCallback((payload: AddPayload, from?: DOMRect | null, label?: string) => {
    const next = dispatch({ type: 'add', payload })
    if (!next) return // at the cap — no animation for something that didn't happen
    setSummoned(true)
    haptic('select')
    if (from && label) fly(from, label)
    else setBumpKey((n) => n + 1)
  }, [dispatch, fly])

  const openSheet = useCallback(() => setSheetOpen(true), [])
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  const value = useMemo<CartContextValue>(() => ({
    ready, cart, lang, summoned, activeDinerId, setActiveDinerId,
    dispatch, addToCart, clearAll,
    sheetOpen, openSheet, closeSheet,
    registerFab, bumpKey, actions,
  }), [
    ready, cart, lang, summoned, activeDinerId,
    dispatch, addToCart, clearAll, sheetOpen, openSheet, closeSheet,
    registerFab, bumpKey, actions,
  ])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
