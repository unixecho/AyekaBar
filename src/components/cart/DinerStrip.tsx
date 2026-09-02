'use client'

import { useState } from 'react'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { haptic } from '@/lib/haptics'
import type { Lang } from '@/lib/menu/types'
import { CART_UI } from '@/lib/cart/i18n'
import { MAX_DINERS, TABLE_COLOUR } from '@/lib/cart/types'
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
  const { cart, ready, activeDinerId, setActiveDinerId, dispatch, spotlight } = useCart()
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
          and a screen reader should say so. The label is now its own centred
          line above the chips (see .cart-whostrip in cart.css for why), so
          the radios live in their own row inside it — the `radiogroup` role
          moves down to that row, because a group whose children are a label
          AND the radios describes itself less clearly than one that contains
          only radios. */}
      <div className="cart-whostrip" data-spotlight={spotlight}>
        <span className="cart-whostrip-label" aria-hidden>{CART_UI.addingFor[lang]}:</span>

        <div className="cart-whostrip-row" role="radiogroup" aria-label={CART_UI.addingFor[lang]}>
          <button
            type="button" className="cart-who" role="radio"
            aria-checked={activeDinerId === null}
            data-on={activeDinerId === null}
            onClick={() => { haptic('select'); setActiveDinerId(null) }}
            style={whoStyle(TABLE_COLOUR, activeDinerId === null)}
          >
            <Dot colour={TABLE_COLOUR} />{CART_UI.table[lang]}
          </button>

          {cart.diners.map((d) => (
            <button
              key={d.id} type="button" className="cart-who" role="radio"
              aria-checked={activeDinerId === d.id}
              data-on={activeDinerId === d.id}
              onClick={() => { haptic('select'); setActiveDinerId(d.id) }}
              style={whoStyle(d.colour, activeDinerId === d.id)}
            >
              <Dot colour={d.colour} />{d.name}
            </button>
          ))}

          {cart.diners.length < MAX_DINERS && (
            <button type="button" className="cart-who" onClick={askForDiner} aria-label={CART_UI.addDiner[lang]}>
              + {CART_UI.addDiner[lang]}
            </button>
          )}
        </div>
      </div>

      <PromptSheet request={prompt} onClose={() => setPrompt(null)} />
    </>
  )
}

/** Each person carries their own colour everywhere they appear — this strip,
 *  the sheet's section header, the chip on each line. That consistency is the
 *  whole point: you find your drinks by colour instead of reading names. */
function whoStyle(colour: string, on: boolean): React.CSSProperties {
  return on
    ? { borderColor: colour, background: `${colour}26`, color: 'var(--text)', boxShadow: `0 0 12px ${colour}44` }
    : { borderColor: `${colour}40` }
}

function Dot({ colour }: { colour: string }) {
  return (
    <span aria-hidden style={{
      width: 8, height: 8, borderRadius: 999, background: colour,
      flex: '0 0 auto', marginInlineEnd: 5, display: 'inline-block',
    }} />
  )
}
