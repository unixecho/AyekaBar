'use client'

import { useMemo, useRef, useState } from 'react'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { haptic } from '@/lib/haptics'
import {
  RTL, loc, type Lang, type Localized, type MenuItem, type MenuOptionGroup,
} from '@/lib/menu/types'
import type { DiscountedItem } from '@/lib/menu/variants'
import { fmtAgorot, type PriceVariant } from '@/lib/cart/variants'
import { CART_UI } from '@/lib/cart/i18n'
import { MAX_DINERS, MAX_NOTE_LEN, MAX_QTY } from '@/lib/cart/types'
import { useCart } from './CartProvider'
import SheetShell from './SheetShell'

// Everything the customer has to decide before a line can exist: which of two
// prices, one choice per option group, who it's for, how many, and anything
// the kitchen needs to know.
//
// The variant part is the same decision the waiter makes in ayeka-staff's own
// add-item flow, from the same parsed data (`lib/cart/variants.ts` is that
// file's twin). It is here rather than left to the waiter because a cart whose
// wine lines could each be 49₪ or 139₪ has a total that means nothing — see
// that file's header for the full argument.

export default function ItemChoiceSheet({
  item, categoryId, categoryTitle, variants, optionGroups, lang, onClose,
}: {
  item: MenuItem
  categoryId: string
  categoryTitle: Localized
  variants: PriceVariant[]
  optionGroups: MenuOptionGroup[]
  lang: Lang
  onClose: () => void
}) {
  const { cart, dispatch, addToCart, activeDinerId } = useCart()
  const [variantIndex, setVariantIndex] = useState(0)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [dinerId, setDinerId] = useState<string | null>(activeDinerId)
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  const dir = RTL[lang] ? 'rtl' : 'ltr'
  const name = loc(item, lang)
  const variant = variants[variantIndex] ?? variants[0]
  const unitAgorot = variant ? variant.agorot : null

  const missing = useMemo(
    () => optionGroups.filter((g) => !choices[g.id]),
    [optionGroups, choices],
  )
  const canAdd = missing.length === 0

  function pick(groupId: string, choiceId: string) {
    haptic('select')
    setChoices((c) => ({ ...c, [groupId]: choiceId }))
  }

  function confirm() {
    if (!canAdd || !item.uid) return
    const selected = optionGroups.flatMap((g) => {
      const choiceId = choices[g.id]
      const choice = g.choices.find((c) => c.id === choiceId)
      if (!choice) return []
      return [{
        groupId: g.id,
        choiceId: choice.id,
        label: { he: choice.he, en: choice.en, ar: choice.ar },
        groupLabel: g.label,
      }]
    })

    addToCart({
      itemUid: item.uid,
      name: { he: item.he, en: item.en, ar: item.ar },
      variantLabel: variant?.label ?? {},
      variantIndex,
      unitAgorot,
      priceText: typeof item.price === 'string' ? item.price : item.price != null ? String(item.price) : '',
      categoryId,
      categoryTitle,
      selectedOptions: selected,
      dinerId,
      qty,
      note,
      happyHourPercent: (item as DiscountedItem).discountPercent,
    }, confirmRef.current?.getBoundingClientRect() ?? null, name)

    onClose()
  }

  function askForDiner() {
    setPrompt({
      title: CART_UI.addDiner[lang],
      body: CART_UI.dinerNameHint[lang],
      placeholder: CART_UI.dinerNamePlaceholder[lang],
      confirmLabel: CART_UI.addDiner[lang],
      onConfirm: (value) => {
        // The reducer refuses a duplicate name and enforces the cap, so read
        // the cart it hands back rather than assuming the add landed. A new
        // diner is appended, so they are last — and selecting them straight
        // away is the whole reason someone taps "+ סועד" from inside this
        // sheet: they are adding this drink FOR that person.
        const next = dispatch({ type: 'addDiner', name: value })
        const added = next?.diners[next.diners.length - 1]
        if (added) setDinerId(added.id)
      },
    })
  }

  const lineTotal = unitAgorot === null ? null : unitAgorot * qty

  return (
    <>
      <SheetShell
        open
        onClose={onClose}
        label={name}
        dir={dir}
        suspended={prompt !== null}
        footer={
          <div className="cart-foot">
            <button
              ref={confirmRef}
              type="button"
              className="cart-primary press"
              onClick={confirm}
              disabled={!canAdd}
              style={{ opacity: canAdd ? 1 : 0.45, cursor: canAdd ? 'pointer' : 'not-allowed' }}
            >
              {CART_UI.addForTotal[lang]}
              {lineTotal !== null && (
                <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtAgorot(lineTotal)}₪
                </span>
              )}
            </button>
            {!canAdd && (
              <p className="cart-foot-note" style={{ margin: '8px 0 0', textAlign: 'center' }}>
                {CART_UI.chooseHint[lang]}
              </p>
            )}
          </div>
        }
      >
        <div className="cart-sheet-head">
          <h2 className="cart-sheet-title">{name}</h2>
          <button type="button" className="cart-sheet-icon-btn press" onClick={onClose} aria-label={CART_UI.close[lang]}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="sheet-scroll">
          {loc(item.note, lang) && (
            <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {loc(item.note, lang)}
            </p>
          )}

          {variants.length > 1 && (
            <fieldset style={fieldsetStyle}>
              <legend className="cart-choice-label">{CART_UI.chooseSize[lang]}</legend>
              <div className="cart-choice-row">
                {variants.map((v, i) => (
                  <button
                    key={i} type="button" className="cart-choice press"
                    data-on={i === variantIndex}
                    aria-pressed={i === variantIndex}
                    onClick={() => { haptic('select'); setVariantIndex(i) }}
                  >
                    <span>{loc(v.label, lang) || `${i + 1}`}</span>
                    <span className="cart-choice-price">{fmtAgorot(v.agorot)}₪</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {optionGroups.map((g) => (
            <fieldset key={g.id} style={fieldsetStyle}>
              <legend className="cart-choice-label">{loc(g.label, lang)}</legend>
              <div className="cart-choice-row">
                {g.choices.map((c) => (
                  <button
                    key={c.id} type="button" className="cart-choice press"
                    data-on={choices[g.id] === c.id}
                    aria-pressed={choices[g.id] === c.id}
                    onClick={() => pick(g.id, c.id)}
                  >
                    {loc(c, lang)}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset style={fieldsetStyle}>
            <legend className="cart-choice-label">{CART_UI.forWhom[lang]}</legend>
            <div className="cart-choice-row">
              <button
                type="button" className="cart-choice press" data-on={dinerId === null}
                aria-pressed={dinerId === null}
                onClick={() => { haptic('select'); setDinerId(null) }}
              >{CART_UI.table[lang]}</button>
              {cart.diners.map((d) => (
                <button
                  key={d.id} type="button" className="cart-choice press" data-on={dinerId === d.id}
                  aria-pressed={dinerId === d.id}
                  onClick={() => { haptic('select'); setDinerId(d.id) }}
                >{d.name}</button>
              ))}
              {cart.diners.length < MAX_DINERS && (
                <button type="button" className="cart-choice press" onClick={askForDiner}>
                  + {CART_UI.addDiner[lang]}
                </button>
              )}
            </div>
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend className="cart-choice-label">{CART_UI.quantity[lang]}</legend>
            <div className="cart-line-step" style={{ height: 42 }}>
              <button
                type="button" onClick={() => { haptic('tick'); setQty((q) => Math.max(1, q - 1)) }}
                aria-label={CART_UI.removeOne[lang]}
              >−</button>
              <span aria-live="polite" aria-atomic="true">{qty}</span>
              <button
                type="button" onClick={() => { haptic('tick'); setQty((q) => Math.min(MAX_QTY, q + 1)) }}
                aria-label={CART_UI.addOne[lang]}
              >+</button>
            </div>
          </fieldset>

          <fieldset style={fieldsetStyle}>
            <legend className="cart-choice-label">{CART_UI.note[lang]}</legend>
            <input
              className="cart-note-input"
              value={note}
              maxLength={MAX_NOTE_LEN}
              placeholder={CART_UI.notePlaceholder[lang]}
              aria-label={CART_UI.noteAria[lang]}
              onChange={(e) => setNote(e.target.value)}
            />
          </fieldset>
        </div>
      </SheetShell>

      {/* Rendered outside the shell so it portals above it; `suspended` above
          is what hands it the Escape key while it is up. */}
      <PromptSheet request={prompt} onClose={() => setPrompt(null)} />
    </>
  )
}

const fieldsetStyle: React.CSSProperties = {
  border: 0, padding: 0, margin: 0, minWidth: 0,
}
