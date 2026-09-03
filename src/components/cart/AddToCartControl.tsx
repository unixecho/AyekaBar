'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { haptic } from '@/lib/haptics'
import { loc, type Lang, type Localized, type MenuItem } from '@/lib/menu/types'
import type { DiscountedItem } from '@/lib/menu/variants'
import { needsChoice, toVariants } from '@/lib/cart/variants'
import { qtyOfItem } from '@/lib/cart/store'
import { CART_UI } from '@/lib/cart/i18n'
import { useCart } from './CartProvider'
import ItemChoiceSheet from './ItemChoiceSheet'

// The control that sits at the end of a menu row. Two states, the shape every
// delivery app has trained people to read: a plain "add" until there is one in
// the order, a stepper after that.
//
// WHAT THE NUMBER MEANS. It is the total of this item across the WHOLE cart —
// every size, every diner. That is the honest answer to "how many of these am
// I ordering", and it is the only reading that stays true once the same drink
// exists twice under two names. Which is also why "−" removes from the
// most-recently-added line rather than picking one: on a menu row there is no
// way to say which "דנה's" it should take, so it undoes the last tap and
// leaves precise editing to the cart sheet, where the lines are visible.

export default function AddToCartControl({
  item, categoryId, categoryTitle, lang,
}: {
  item: MenuItem
  categoryId: string
  categoryTitle: Localized
  lang: Lang
}) {
  const { cart, ready, dispatch, addToCart, activeDinerId } = useCart()
  const [choosing, setChoosing] = useState(false)

  const variants = useMemo(() => toVariants(item.price, categoryId), [item.price, categoryId])
  const optionGroups = useMemo(
    () => (item.options ?? []).filter((g) => (g.choices?.length ?? 0) > 0),
    [item.options],
  )

  // An item with no uid can't be addressed — a legacy row the editor's
  // ensureUids() hasn't minted an id for yet. Show the menu, skip the control,
  // rather than adding a line that can never be matched to a menu item again.
  if (!item.uid) return null
  // Sold out: no control at all. A disabled "add" invites tapping it.
  if (item.available === false) return null
  // Before localStorage has been read there is no honest number to show, and
  // rendering "0" then correcting it to "3" is a hydration mismatch.
  if (!ready) return null

  const uid = item.uid
  const qty = qtyOfItem(cart, uid)
  const linesForItem = cart.lines.filter((l) => l.itemUid === uid)
  const name = loc(item, lang)

  // ASK EVERY TIME, ONCE THE TABLE HAS SPLIT. "on each new item we need to ask
  // which diner is it going to" (owner, 2026-09-01). Before this, the first
  // add set an active diner and every later add silently followed it, so a
  // round meant for three people quietly piled onto whoever was selected.
  //
  // The one case that is NOT asked is when nobody has been named yet: with no
  // diners there is exactly one possible answer, and a sheet offering a single
  // choice is a dialog that exists to be dismissed.
  const mustChoose = needsChoice(variants, optionGroups) || cart.diners.length > 0

  function addPlain(from: DOMRect | null) {
    const v = variants[0]
    addToCart({
      itemUid: uid,
      name: { he: item.he, en: item.en, ar: item.ar },
      variantLabel: v?.label ?? {},
      variantIndex: 0,
      unitAgorot: v ? v.agorot : null,
      priceText: typeof item.price === 'string' ? item.price : item.price != null ? String(item.price) : '',
      categoryId,
      categoryTitle,
      dinerId: activeDinerId,
      happyHourPercent: (item as DiscountedItem).discountPercent,
    }, from, name)
  }

  function onPlus(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    // "+" on a row that already has exactly ONE open line means "one more of
    // the same" — the customer answered every question the first time, and
    // re-asking would be pedantic. Zero lines is a NEW item and gets asked;
    // two or more is genuinely ambiguous and gets asked.
    //
    // `openLines` and not all lines: a line already shown to the waiter is a
    // closed round. Adding to it would hide the new drink inside something
    // the customer has already read out, so that case opens the sheet and
    // starts a fresh line.
    const open = linesForItem.filter((l) => l.presentedAt === undefined)
    if (mustChoose && open.length !== 1) { setChoosing(true); return }
    if (mustChoose && open.length === 1) {
      const line = open[0]
      addToCart({
        itemUid: uid,
        name: line.name,
        variantLabel: line.variantLabel,
        variantIndex: line.variantIndex,
        unitAgorot: line.unitAgorot,
        priceText: line.priceText,
        categoryId: line.categoryId,
        categoryTitle: line.categoryTitle,
        selectedOptions: line.selectedOptions,
        dinerId: line.dinerId,
        note: line.note,
        happyHourPercent: line.happyHourPercent,
      }, rect, name)
      return
    }
    addPlain(rect)
  }

  function onMinus() {
    haptic('tick')
    dispatch({ type: 'decrementItem', itemUid: uid })
  }

  return (
    <>
      {/* A11y backlog A9: a PERSISTENT live region, separate from the
          stepper's own visible aria-live span below. That one only exists
          once qty > 0, so it is a brand-new DOM node on the very first add —
          and screen readers reliably announce MUTATIONS to an existing live
          region, not the initial content of a freshly-mounted one. This span
          never unmounts (it renders regardless of qty), so the 0→1 tap that
          swaps "add" for the stepper is the one case this actually covers. */}
      <span aria-live="polite" aria-atomic="true" style={srOnly}>
        {qty > 0 ? `${name} — ${CART_UI.quantity[lang]} ${qty}` : ''}
      </span>

      {qty === 0 ? (
        <button
          type="button"
          className="cart-add press"
          onClick={onPlus}
          aria-label={`${CART_UI.add[lang]} — ${name}`}
        >
          <span className="cart-add-plus" aria-hidden>+</span>
          <span>{CART_UI.add[lang]}</span>
        </button>
      ) : (
        <div className="cart-step" role="group" aria-label={`${name} — ${CART_UI.quantity[lang]}`}>
          <button
            type="button" className="cart-step-btn"
            onClick={onMinus}
            aria-label={`${CART_UI.removeOne[lang]} — ${name}`}
          >−</button>
          {/* aria-live so a screen-reader user hears the count change without
              having to go looking for it after every tap. */}
          <span className="cart-step-qty" aria-live="polite" aria-atomic="true">{qty}</span>
          <button
            type="button" className="cart-step-btn"
            onClick={onPlus}
            aria-label={`${CART_UI.addOne[lang]} — ${name}`}
          >+</button>
        </div>
      )}

      {choosing && (
        <ItemChoiceSheet
          item={item}
          categoryId={categoryId}
          categoryTitle={categoryTitle}
          variants={variants}
          optionGroups={optionGroups}
          lang={lang}
          onClose={() => setChoosing(false)}
        />
      )}
    </>
  )
}

/** Visually hidden but still reachable by assistive tech — the standard
 *  clip-path technique (`display:none`/`visibility:hidden` would pull it out
 *  of the accessibility tree too, defeating the point). Same values as the
 *  feedback form's honeypot wrapper, for the same reason: 1px, not 0, so
 *  Safari never treats the box as having no size and skips it. */
const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden',
  clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0, padding: 0, margin: -1,
}
