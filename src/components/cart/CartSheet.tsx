'use client'

import { useMemo, useState } from 'react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { haptic } from '@/lib/haptics'
import { MENU_UI, RTL, loc, type Lang } from '@/lib/menu/types'
import { cartTotals, groupByDiner, type CartAction, type DinerGroup } from '@/lib/cart/store'
import { fmtAgorot } from '@/lib/cart/variants'
import { CART_UI } from '@/lib/cart/i18n'
import { MAX_DINERS, type Cart, type CartLine } from '@/lib/cart/types'
import { useCart } from './CartProvider'
import SheetShell from './SheetShell'

// The cart itself: what's in it, who it's for, what it comes to.
//
// TWO MODES, ONE SHEET.
//   edit    — steppers, diner chips, remove buttons. What the customer uses.
//   readout — none of those, larger type, grouped by person. What the WAITER
//             looks at over the customer's shoulder.
// The second mode is the actual product of Phase 1. "I don't have to remember
// four cocktail names and who wanted what" (PLAN_MENU_CART §1) is only solved
// if there is something legible to hand over; a screen full of ± buttons and
// bins is a form, not an order. It is one mode rather than a second route
// because it must be reachable and dismissable in one tap while a waiter is
// standing there waiting.

type Mode = 'edit' | 'readout'

export default function CartSheet({ lang }: { lang: Lang }) {
  const { cart, sheetOpen, closeSheet, dispatch, clearAll, actions, setActiveDinerId } = useCart()
  const [mode, setMode] = useState<Mode>('edit')
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [pickingFor, setPickingFor] = useState<string | null>(null)

  const dir = RTL[lang] ? 'rtl' : 'ltr'
  const groups = useMemo(() => groupByDiner(cart), [cart])
  const { agorot, unpricedLines } = cartTotals(cart)
  const empty = cart.lines.length === 0
  const split = cart.diners.length > 0

  function close() {
    setMode('edit')
    setPickingFor(null)
    closeSheet()
  }

  function addDiner() {
    setPrompt({
      title: CART_UI.addDiner[lang],
      body: CART_UI.dinerNameHint[lang],
      placeholder: CART_UI.dinerNamePlaceholder[lang],
      confirmLabel: CART_UI.addDiner[lang],
      onConfirm: (value) => {
        const next = dispatch({ type: 'addDiner', name: value })
        const added = next?.diners[next.diners.length - 1]
        // Adding someone is almost always followed by ordering for them, so
        // make them the active diner — the next tap on the menu lands where
        // the customer already expects it to.
        if (added) setActiveDinerId(added.id)
      },
    })
  }

  function renameDiner(id: string, current: string) {
    setPrompt({
      title: CART_UI.renameDiner[lang],
      placeholder: CART_UI.dinerNamePlaceholder[lang],
      defaultValue: current,
      confirmLabel: CART_UI.renameDiner[lang],
      onConfirm: (value) => { dispatch({ type: 'renameDiner', dinerId: id, name: value }) },
    })
  }

  function removeDiner(id: string, name: string) {
    setConfirm({
      title: `${CART_UI.removeDiner[lang]}: ${name}`,
      body: CART_UI.removeDinerBody[lang],
      confirmLabel: CART_UI.removeDiner[lang],
      onConfirm: () => { haptic('impact'); dispatch({ type: 'removeDiner', dinerId: id }) },
    })
  }

  function editNote(lineId: string, current: string | undefined) {
    setPrompt({
      title: CART_UI.note[lang],
      body: CART_UI.noteHint[lang],
      placeholder: CART_UI.notePlaceholder[lang],
      defaultValue: current ?? '',
      confirmLabel: CART_UI.save[lang],
      // Clearing the field IS a valid edit here — the note is optional, and
      // the reducer treats an empty string as "remove the note".
      allowEmpty: true,
      onConfirm: (value) => { dispatch({ type: 'setNote', lineId, note: value }) },
    })
  }

  function askClear() {
    setConfirm({
      title: CART_UI.clearTitle[lang],
      body: CART_UI.clearBody[lang],
      confirmLabel: CART_UI.clearConfirm[lang],
      onConfirm: () => { haptic('impact'); clearAll(); setMode('edit') },
    })
  }

  const nested = prompt !== null || confirm !== null

  const footer = (
    <div className="cart-foot">
      <div className="cart-total-row">
        <span className="cart-total-label">{CART_UI.total[lang]}</span>
        <span className="cart-total-value" dir="ltr">{fmtAgorot(agorot)}₪</span>
      </div>
      <p className="cart-foot-note">
        {CART_UI.estimateNote[lang]}
        {unpricedLines > 0 && <> {CART_UI.priceOnChoice[lang]}.</>}
      </p>

      {mode === 'edit' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button" className="cart-primary press"
            onClick={() => { haptic('select'); setMode('readout') }}
            disabled={empty}
            style={{ opacity: empty ? 0.45 : 1, cursor: empty ? 'not-allowed' : 'pointer' }}
          >
            {CART_UI.showWaiter[lang]}
          </button>

          {/* The two things that don't work yet. Visible and inert, with the
              reason attached — see PLAN_MENU_CART §4.8. `disabled` is real,
              not styling: `aria-disabled` alone would still let a keyboard
              user activate them.

              `actions.*` comes from an owner switch, but a switch flipped in
              the database cannot light these up on its own — the constant
              below is the second lock, and it only moves in the same commit
              that ships an endpoint for them to call. */}
          {/* Side by side, not stacked. Two full-width dead buttons plus their
              explanation ate ~110px of a 714px sheet, and every one of those
              pixels comes out of the scrolling list of what the customer
              actually ordered. They still have to be VISIBLE — that is the
              request — but they do not have to be the loudest thing here. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button type="button" className="cart-soon" disabled={!(actions.ordering && PHASE_2_BUILT)}>
              {CART_UI.sendToWaiter[lang]}
              <span className="cart-soon-badge">{CART_UI.soon[lang]}</span>
            </button>
            <button type="button" className="cart-soon" disabled={!(actions.call && PHASE_3_BUILT)}>
              {CART_UI.callWaiter[lang]}
              <span className="cart-soon-badge">{CART_UI.soon[lang]}</span>
            </button>
          </div>

          <p className="cart-foot-note" style={{ margin: '2px 0 0' }}>{CART_UI.soonHint[lang]}</p>
        </div>
      ) : (
        <button type="button" className="cart-primary press" onClick={() => setMode('edit')}>
          {CART_UI.backToCart[lang]}
        </button>
      )}
    </div>
  )

  return (
    <>
      <SheetShell
        open={sheetOpen}
        onClose={close}
        label={mode === 'edit' ? CART_UI.title[lang] : CART_UI.readoutTitle[lang]}
        dir={dir}
        suspended={nested}
        footer={footer}
      >
        <div className="cart-sheet-head">
          <h2 className="cart-sheet-title">
            {mode === 'edit' ? CART_UI.title[lang] : CART_UI.readoutTitle[lang]}
          </h2>
          {mode === 'edit' && !empty && (
            <button type="button" className="cart-sheet-icon-btn press" data-danger="true" onClick={askClear}>
              {CART_UI.clear[lang]}
            </button>
          )}
          <button type="button" className="cart-sheet-icon-btn press" onClick={close} aria-label={CART_UI.close[lang]}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="sheet-scroll">
          {mode === 'readout' ? (
            <>
              <p className="cart-foot-note" style={{ margin: '0 0 6px' }}>{CART_UI.readoutHint[lang]}</p>
              {groups
                .filter((g) => g.lines.length > 0)
                .map((g) => (
                  <ReadoutGroup key={g.diner?.id ?? '~table'} group={g} lang={lang} split={split} />
                ))}
            </>
          ) : empty ? (
            <div style={{ padding: '28px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: 10 }} aria-hidden>🍸</div>
              <p style={{ margin: 0, color: 'var(--text)', fontWeight: 600 }}>{CART_UI.empty[lang]}</p>
              <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                {CART_UI.emptyHint[lang]}
              </p>
            </div>
          ) : (
            <>
              {/* With nobody named there is nothing to contrast "לשולחן"
                  against, so a section header would be a label on the only
                  thing there is. Bare list until the table actually splits. */}
              {!split && cart.lines.map((line) => (
                <div className="cart-group" key={line.id}>
                  <LineRow
                    line={line} lang={lang} cart={cart} dispatch={dispatch}
                    onEditNote={() => editNote(line.id, line.note)}
                    picking={pickingFor === line.id}
                    onPick={() => setPickingFor((cur) => (cur === line.id ? null : line.id))}
                    onPicked={() => setPickingFor(null)}
                  />
                </div>
              ))}

              {split && groups.map((g) => {
                if (g.diner === null && g.lines.length === 0) return null
                return (
                  <section className="cart-group" key={g.diner?.id ?? '~table'} data-table={g.diner === null}>
                    <header className="cart-group-head">
                      <h3 className="cart-group-name">{g.diner ? g.diner.name : CART_UI.table[lang]}</h3>
                      {g.lines.length > 0 && (
                        <span className="cart-group-sum" dir="ltr">{fmtAgorot(g.totals.agorot)}₪</span>
                      )}
                      {g.diner && (
                        <>
                          <button
                            type="button" className="cart-chip press"
                            onClick={() => renameDiner(g.diner!.id, g.diner!.name)}
                            aria-label={`${CART_UI.renameDiner[lang]} — ${g.diner.name}`}
                          >✎</button>
                          <button
                            type="button" className="cart-chip press" data-danger="true"
                            onClick={() => removeDiner(g.diner!.id, g.diner!.name)}
                            aria-label={`${CART_UI.removeDiner[lang]} — ${g.diner.name}`}
                          >✕</button>
                        </>
                      )}
                    </header>
                    {g.lines.length === 0 ? (
                      <p className="cart-group-empty">{CART_UI.nothingYet[lang]}</p>
                    ) : (
                      g.lines.map((line) => (
                        <LineRow
                          key={line.id} line={line} lang={lang} cart={cart} dispatch={dispatch}
                          onEditNote={() => editNote(line.id, line.note)}
                          picking={pickingFor === line.id}
                          onPick={() => setPickingFor((cur) => (cur === line.id ? null : line.id))}
                          onPicked={() => setPickingFor(null)}
                        />
                      ))
                    )}
                  </section>
                )
              })}

              {cart.diners.length < MAX_DINERS && (
                <button type="button" className="cart-add-diner press" onClick={addDiner}>
                  + {CART_UI.addDiner[lang]}
                </button>
              )}

              <p className="cart-foot-note" style={{ margin: '4px 0 0', textAlign: 'center' }}>
                {CART_UI.localOnly[lang]}
              </p>
            </>
          )}
        </div>
      </SheetShell>

      {/* Both portal above the sheet; `suspended` hands them the Escape key. */}
      <PromptSheet request={prompt} onClose={() => setPrompt(null)} />
      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </>
  )
}

/** The second lock on the two future actions — see the buttons above. Flipped
 *  to true in the same change that ships the endpoint each one calls, never
 *  before, so that turning the owner switch on early can only be harmless.
 *  Typed `boolean` rather than inferred as the literal `false` so the checks
 *  above read as real conditions to both the compiler and the next reader. */
const PHASE_2_BUILT: boolean = false
const PHASE_3_BUILT: boolean = false

function LineRow({
  line, lang, cart, dispatch, picking, onPick, onPicked, onEditNote,
}: {
  line: CartLine
  lang: Lang
  cart: Cart
  dispatch: (action: CartAction) => Cart | null
  picking: boolean
  onPick: () => void
  onPicked: () => void
  onEditNote: () => void
}) {
  const name = loc(line.name, lang)
  const variant = loc(line.variantLabel, lang)
  const diner = line.dinerId ? cart.diners.find((d) => d.id === line.dinerId) : null
  const dinerLabel = diner ? diner.name : CART_UI.table[lang]
  const lineTotal = line.unitAgorot === null ? null : line.unitAgorot * line.qty

  return (
    <div className="cart-line">
      <div className="cart-line-main">
        <div className="cart-line-name">
          {name}
          {variant && <span className="cart-line-variant">{' · '}{variant}</span>}
          {!!line.happyHourPercent && (
            <span className="cart-hh">{MENU_UI.happyHour[lang]} −{line.happyHourPercent}%</span>
          )}
        </div>

        {line.selectedOptions.map((o) => (
          <div className="cart-line-meta" key={`${o.groupId}-${o.choiceId}`}>
            {loc(o.groupLabel, lang)}: {loc(o.label, lang)}
          </div>
        ))}
        {line.note && <div className="cart-line-meta">“{line.note}”</div>}
        {line.unitAgorot === null && (
          <div className="cart-line-unpriced">
            {line.priceText && <span dir="ltr">{line.priceText}₪ · </span>}
            {CART_UI.priceOnChoice[lang]}
          </div>
        )}

        <div className="cart-line-tools">
          <div className="cart-line-step" role="group" aria-label={`${name} — ${CART_UI.quantity[lang]}`}>
            {/* At qty 1 the "−" becomes the bin, which is what every delivery
                app does and what makes a fourth control unnecessary: a stepper
                plus three chips wrapped onto two rows at 375px and left the
                lone bin on the second row, reading as a layout bug. Stepping
                to zero already removed the line (the reducer turns qty<=0 into
                a removal) — this only makes that legible. */}
            <button
              type="button"
              aria-label={`${(line.qty === 1 ? CART_UI.removeLine : CART_UI.removeOne)[lang]} — ${name}`}
              onClick={() => {
                haptic(line.qty === 1 ? 'impact' : 'tick')
                dispatch({ type: 'setQty', lineId: line.id, qty: line.qty - 1 })
              }}
              style={line.qty === 1 ? { color: '#ff6b6b', fontSize: '0.95rem' } : undefined}
            >{line.qty === 1 ? '🗑' : '−'}</button>
            <span aria-live="polite" aria-atomic="true">{line.qty}</span>
            <button
              type="button" aria-label={`${CART_UI.addOne[lang]} — ${name}`}
              onClick={() => { haptic('tick'); dispatch({ type: 'setQty', lineId: line.id, qty: line.qty + 1 }) }}
            >+</button>
          </div>

          <button
            type="button" className="cart-chip press"
            data-assigned={!!diner}
            aria-expanded={picking}
            aria-label={`${CART_UI.assignedTo[lang]} ${dinerLabel} — ${CART_UI.assignTo[lang]}`}
            onClick={onPick}
          >
            <span aria-hidden>👤</span>{dinerLabel}
          </button>

          {/* A note can be added when the line is created but, until this
              existed, never corrected — the only way to fix a typo in
              "בלי קרח" was to delete the line and rebuild it. */}
          <button
            type="button" className="cart-chip press"
            data-assigned={!!line.note}
            aria-label={`${CART_UI.noteAria[lang]} — ${name}`}
            onClick={onEditNote}
          >
            <span aria-hidden>✎</span>{line.note ? CART_UI.noteEdit[lang] : CART_UI.note[lang]}
          </button>

        </div>

        {/* Inline rather than a nested dialog: a picker with four chips does
            not deserve a second modal layer on top of the sheet, and every
            destination is one tap away in place. */}
        {picking && (
          <div className="cart-line-tools" style={{ marginTop: 6 }}>
            <button
              type="button" className="cart-chip press" data-assigned={line.dinerId === null}
              onClick={() => { haptic('select'); dispatch({ type: 'assignLine', lineId: line.id, dinerId: null }); onPicked() }}
            >{CART_UI.table[lang]}</button>
            {cart.diners.map((d) => (
              <button
                key={d.id} type="button" className="cart-chip press" data-assigned={line.dinerId === d.id}
                onClick={() => { haptic('select'); dispatch({ type: 'assignLine', lineId: line.id, dinerId: d.id }); onPicked() }}
              >{d.name}</button>
            ))}
          </div>
        )}
      </div>

      <div className="cart-line-price">{lineTotal === null ? '—' : `${fmtAgorot(lineTotal)}₪`}</div>
    </div>
  )
}

function ReadoutGroup({ group, lang, split }: { group: DinerGroup; lang: Lang; split: boolean }) {
  return (
    <section className="cart-readout-group">
      {split && (
        <h3 className="cart-readout-name" style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {group.diner ? group.diner.name : CART_UI.table[lang]}
          </span>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }} dir="ltr">
            {fmtAgorot(group.totals.agorot)}₪
          </span>
        </h3>
      )}
      {group.lines.map((line) => {
        const variant = loc(line.variantLabel, lang)
        const opts = line.selectedOptions.map((o) => loc(o.label, lang)).filter(Boolean).join(' · ')
        return (
          <div className="cart-readout-line" key={line.id}>
            <span className="cart-readout-qty">{line.qty}×</span>
            <span>
              {loc(line.name, lang)}
              {variant && <span style={{ color: 'var(--neon-soft)' }}>{' · '}{variant}</span>}
              {!!line.happyHourPercent && (
                <span className="cart-hh">{MENU_UI.happyHour[lang]} −{line.happyHourPercent}%</span>
              )}
              {opts && <span style={{ color: 'var(--text-dim)' }}>{' · '}{opts}</span>}
              {line.note && <span className="cart-readout-note">“{line.note}”</span>}
            </span>
          </div>
        )
      })}
    </section>
  )
}
