'use client'

import { useState } from 'react'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { haptic } from '@/lib/haptics'
import type { Lang } from '@/lib/menu/types'
import { CART_UI } from '@/lib/cart/i18n'
import { MAX_DINERS } from '@/lib/cart/types'
import { useCart } from './CartProvider'

// "Who am I adding this for?", answered once and then reused for every tap.
//
// WITHOUT THIS, SPLITTING IS BUSYWORK. Every add would land on the table and
// the customer would have to reopen the sheet and reassign each line one at a
// time — for a table of four that is twenty extra taps to do the one thing
// this feature exists for. With it, you name people once and then just order.
//
// It appears only once the cart has something in it: before the first add
// there is nothing to split, and a strip asking who an empty order is for is
// a question with no subject. It sits inside the sticky header (below the
// category chips) so it stays visible while browsing, which is exactly when
// the answer changes — that is also why MenuView measures its sticky bar with
// a ResizeObserver rather than on a fixed set of dependencies.

export default function DinerStrip({ lang }: { lang: Lang }) {
  const { cart, ready, activeDinerId, setActiveDinerId, dispatch } = useCart()
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)

  if (!ready || cart.lines.length === 0) return null

  function askForDiner() {
    setPrompt({
      title: CART_UI.addDiner[lang],
      body: CART_UI.dinerNameHint[lang],
      placeholder: CART_UI.dinerNamePlaceholder[lang],
      confirmLabel: CART_UI.addDiner[lang],
      onConfirm: (value) => {
        const next = dispatch({ type: 'addDiner', name: value })
        const added = next?.diners[next.diners.length - 1]
        if (added) setActiveDinerId(added.id)
      },
    })
  }

  return (
    <>
      {/* A radiogroup, not a row of buttons: exactly one is chosen at a time,
          and a screen reader should say so. */}
      <div className="cart-whostrip" role="radiogroup" aria-label={CART_UI.addingFor[lang]}>
        <span className="cart-whostrip-label" aria-hidden>{CART_UI.addingFor[lang]}:</span>

        <button
          type="button" className="cart-who" role="radio"
          aria-checked={activeDinerId === null}
          data-on={activeDinerId === null}
          onClick={() => { haptic('select'); setActiveDinerId(null) }}
        >{CART_UI.table[lang]}</button>

        {cart.diners.map((d) => (
          <button
            key={d.id} type="button" className="cart-who" role="radio"
            aria-checked={activeDinerId === d.id}
            data-on={activeDinerId === d.id}
            onClick={() => { haptic('select'); setActiveDinerId(d.id) }}
          >{d.name}</button>
        ))}

        {cart.diners.length < MAX_DINERS && (
          <button type="button" className="cart-who" onClick={askForDiner} aria-label={CART_UI.addDiner[lang]}>
            + {CART_UI.addDiner[lang]}
          </button>
        )}
      </div>

      <PromptSheet request={prompt} onClose={() => setPrompt(null)} />
    </>
  )
}
