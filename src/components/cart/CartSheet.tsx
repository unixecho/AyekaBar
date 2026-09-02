'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import PromptSheet, { type PromptRequest } from '@/components/PromptSheet'
import { haptic } from '@/lib/haptics'
import { MENU_UI, RTL, loc, type Lang } from '@/lib/menu/types'
import { cartTotals, groupByDiner, hasPresented, openLines, totals, type CartAction, type DinerGroup } from '@/lib/cart/store'
import { fmtAgorot } from '@/lib/cart/variants'
import { CART_UI } from '@/lib/cart/i18n'
import { MAX_DINERS, TABLE_COLOUR, type Cart, type CartLine } from '@/lib/cart/types'
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
  // In read-out mode, show only the round that has not been given to the
  // waiter yet. That IS the useful view the second time they come over.
  const [readoutAll, setReadoutAll] = useState(false)

  const dir = RTL[lang] ? 'rtl' : 'ltr'
  const groups = useMemo(() => groupByDiner(cart), [cart])
  const open = useMemo(() => openLines(cart), [cart])
  const readoutLines = readoutAll ? cart.lines : open
  const readoutGroups = useMemo(
    () => groupByDiner(cart, readoutLines),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cart, readoutLines],
  )
  const { agorot, unpricedLines } = cartTotals(cart)
  // The footer's number follows what is ON SCREEN. Showing the whole order's
  // total under a read-out of three new drinks would be a number the waiter
  // could act on and the customer did not mean.
  const shown = mode === 'readout' ? totals(readoutLines) : { agorot, unpricedLines }
  const empty = cart.lines.length === 0
  const split = cart.diners.length > 0
  const anyPresented = hasPresented(cart)

  function close() {
    setMode('edit')
    setPickingFor(null)
    setReadoutAll(false)
    closeSheet()
  }

  /** "הראיתי למלצר" — closes the current round. Deliberately NOT behind a
   *  confirmation and NOT irreversible: the lines stay fully editable, this
   *  only records where the round ended so the next read-out shows what is
   *  new. A mis-tap costs one label, not an order. */
  function markPresented() {
    haptic('select')
    dispatch({ type: 'markPresented' })
    setReadoutAll(false)
    setMode('edit')
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
        <span className="cart-total-value" dir="ltr">{fmtAgorot(shown.agorot)}₪</span>
      </div>
      <p className="cart-foot-note">
        {CART_UI.estimateNote[lang]}
        {shown.unpricedLines > 0 && <> {CART_UI.priceOnChoice[lang]}.</>}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" className="cart-primary press" onClick={() => setMode('edit')}>
            {CART_UI.backToCart[lang]}
          </button>
          {/* Only offered when there is actually an open round to close. */}
          {readoutLines.length > 0 && open.length > 0 && (
            <button type="button" className="cart-secondary press" onClick={markPresented}>
              ✓ {CART_UI.markPresented[lang]}
            </button>
          )}
        </div>
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
              <p className="cart-foot-note" style={{ margin: '0 0 6px' }}>
                {readoutLines.length === 0 ? CART_UI.allPresented[lang] : CART_UI.readoutHint[lang]}
              </p>

              {/* Once a round has been closed, the customer can still pull up
                  everything — useful for checking the bill at the end of the
                  night, useless while ordering, so it is not the default. */}
              {anyPresented && (
                <button
                  type="button" className="cart-chip press"
                  style={{ alignSelf: 'center' }}
                  onClick={() => setReadoutAll((v) => !v)}
                >{readoutAll ? CART_UI.showRound[lang] : CART_UI.showAll[lang]}</button>
              )}

              <ReadoutPages
                groups={readoutGroups.filter((g) => g.lines.length > 0)}
                lang={lang}
                split={split}
              />
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
                  <section
                    className="cart-group" key={g.diner?.id ?? '~table'} data-table={g.diner === null}
                    style={{ borderColor: `${g.diner?.colour ?? TABLE_COLOUR}55` }}
                  >
                    <header
                      className="cart-group-head"
                      style={{ background: `${g.diner?.colour ?? TABLE_COLOUR}14` }}
                    >
                      <span aria-hidden style={{
                        width: 10, height: 10, borderRadius: 999, flex: '0 0 auto',
                        background: g.diner?.colour ?? TABLE_COLOUR,
                        boxShadow: `0 0 10px ${g.diner?.colour ?? TABLE_COLOUR}99`,
                      }} />
                      <h3 className="cart-group-name" style={{ color: g.diner?.colour ?? TABLE_COLOUR }}>
                        {g.diner ? g.diner.name : CART_UI.table[lang]}
                      </h3>
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
  const dinerColour = diner?.colour ?? TABLE_COLOUR
  const lineTotal = line.unitAgorot === null ? null : line.unitAgorot * line.qty
  const presented = line.presentedAt !== undefined

  return (
    <div className="cart-line" data-presented={presented}>
      <div className="cart-line-main">
        <div className="cart-line-name">
          {name}
          {variant && <span className="cart-line-variant">{' · '}{variant}</span>}
          {presented && <span className="cart-presented-tag">✓ {CART_UI.presented[lang]}</span>}
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
            style={{ borderColor: `${dinerColour}66`, color: dinerColour }}
          >
            <span aria-hidden style={{
              width: 8, height: 8, borderRadius: 999, background: dinerColour, flex: '0 0 auto',
            }} />{dinerLabel}
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
              style={{ borderColor: `${TABLE_COLOUR}66`, color: TABLE_COLOUR }}
              onClick={() => { haptic('select'); dispatch({ type: 'assignLine', lineId: line.id, dinerId: null }); onPicked() }}
            >{CART_UI.table[lang]}</button>
            {cart.diners.map((d) => (
              <button
                key={d.id} type="button" className="cart-chip press" data-assigned={line.dinerId === d.id}
                style={{ borderColor: `${d.colour}66`, color: d.colour }}
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

/**
 * The read-out, cut into whole pages instead of one scrolling list.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────
 * "the waiter will take pictures of the order from the customer's phone from
 * now" (2026-09-02). A photograph captures what is on the screen and nothing
 * else, so a list that scrolls silently loses everything below the fold —
 * and nobody discovers it until the wrong drinks arrive. Pages fix that by
 * construction: every page is, by definition, a screen that fits.
 *
 * ── HOW THE PAGES ARE DECIDED ───────────────────────────────────────
 * By MEASUREMENT, not by a guessed items-per-page number. A group's height
 * depends on the name, how many lines it has, whether any line has a note or
 * options, and the font the device actually rendered — none of which is
 * knowable up front, and all of which differ between a 280px Fold and a
 * tablet. So it renders everything once, measures, then slices:
 *
 *   1. First pass (`pages === null`) renders every group and measures each.
 *   2. `overhead` is whatever else shares the scroll area (the hint line, the
 *      show-all chip, the pager bar) — derived as scrollHeight minus the sum
 *      of the group heights, so it never has to be kept in sync by hand.
 *   3. Groups are then packed greedily into pages that fit the remaining
 *      height, and only the current page renders.
 *
 * A GROUP IS NEVER SPLIT ACROSS PAGES. One person's order arriving half on
 * page 1 and half on page 2 is precisely the confusion this is meant to end.
 * A single group taller than a whole page gets its own page and is allowed to
 * scroll — at that point the customer has ordered more for one person than a
 * phone screen can hold, and a photograph was never going to work anyway.
 *
 * WHEN IT ALL FITS, THIS RENDERS NOTHING EXTRA. One page means no pager, no
 * hint, no behaviour change at all — which is the common case and must stay
 * invisible.
 */
function ReadoutPages({ groups, lang, split }: {
  groups: DinerGroup[]
  lang: Lang
  split: boolean
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number[][] | null>(null)
  /** The height one page is allowed to occupy. Pinned onto the host once
   *  paginated — see the ResizeObserver below for why that is load-bearing
   *  and not just tidy. */
  const [pageHeight, setPageHeight] = useState<number | null>(null)
  const [page, setPage] = useState(0)
  /** Space the pager bar and its hint take out of the scroll area. Starts as
   *  an estimate because neither is in the DOM on the pass that decides
   *  whether they are needed at all, then corrects itself against reality —
   *  see the correction effect below. */
  const [reserve, setReserve] = useState(PAGER_RESERVE_PX)
  const corrections = useRef(0)

  // What the pagination depends on. Re-measuring on every render would loop;
  // re-measuring only when the CONTENT changes is what makes this settle.
  const signature = groups.map((g) => `${g.diner?.id ?? '~'}:${g.lines.length}`).join('|')

  useLayoutEffect(() => {
    setPages(null)
    setPageHeight(null)
    setPage(0)
  }, [signature])

  // Re-measure when the sheet itself changes size — rotating the phone, or
  // the keyboard closing, changes how much fits on a page.
  //
  // ⚠️ THIS WAS AN INFINITE RESET LOOP AND THE GUARD IS THE FIX. The sheet
  // panel is content-sized under a max-height, so turning to a shorter page
  // shrank the panel, which resized the scroller, which fired this observer,
  // which re-measured and sent the customer straight back to page 1 — the
  // "next" button appeared to do nothing at all. Two things stop it:
  //
  //   1. `pageHeight` below pins every page to the same height, so paging no
  //      longer changes the panel's size. (It is also simply better: pages
  //      that are all one size photograph consistently.)
  //   2. This observer ignores anything smaller than a real layout change, so
  //      sub-pixel reflow and scrollbar appearance cannot retrigger it.
  useEffect(() => {
    const scroller = hostRef.current?.closest('.sheet-scroll') as HTMLElement | null
    if (!scroller) return
    let last = scroller.clientHeight
    const ro = new ResizeObserver(() => {
      const now = scroller.clientHeight
      if (Math.abs(now - last) < RESIZE_EPSILON_PX) return
      last = now
      setPages(null)
      setPageHeight(null)
      setPage(0)
    })
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (pages !== null) return
    const host = hostRef.current
    const scroller = host?.closest('.sheet-scroll') as HTMLElement | null
    if (!host || !scroller) return

    const els = Array.from(host.querySelectorAll<HTMLElement>('[data-readout-group]'))
    if (els.length === 0) { setPages([]); return }

    const heights = els.map((el) => el.getBoundingClientRect().height)
    const GAP = 8 // .sheet-scroll's own row gap
    const groupsTotal = heights.reduce((a, b) => a + b, 0) + GAP * Math.max(0, heights.length - 1)
    // Everything in the scroll area that is NOT a group. Derived rather than
    // hard-coded so adding a line of copy above can never silently break the
    // arithmetic.
    const overhead = Math.max(0, scroller.scrollHeight - groupsTotal)
    // The pager bar only exists once there is more than one page, so reserve
    // for it up front or the first measurement is optimistic by ~48px and the
    // last page ends up one row too tall.
    const avail = scroller.clientHeight - overhead - reserve

    if (avail <= 0 || groupsTotal <= avail) {
      // Everything fits: one page, and no pinned height — the sheet keeps
      // sizing itself to the content exactly as it always did.
      setPages([Array.from(heights.keys())])
      setPageHeight(null)
      return
    }

    const out: number[][] = []
    let current: number[] = []
    let used = 0
    heights.forEach((h, i) => {
      const cost = h + (current.length ? GAP : 0)
      if (current.length > 0 && used + cost > avail) {
        out.push(current)
        current = [i]
        used = h
      } else {
        current.push(i)
        used += cost
      }
    })
    if (current.length) out.push(current)
    setPages(out)
    // Every page now occupies this exact height. Without it, a short last
    // page shrinks the panel and the ResizeObserver above resets the pager —
    // see its comment. It also stops the sheet jumping about as the waiter
    // pages through, which matters when they are photographing it.
    setPageHeight(avail)
  }, [pages, signature, reserve])

  // ── Correcting the reserve against reality ────────────────────────
  // The first estimate was wrong in production and the symptom was exact: 46px
  // of overflow on every page, because the estimate covered the pager bar but
  // not the "split into pages" hint underneath it. Rather than grow a magic
  // number until it stops being wrong — which would break again the next time
  // a line of copy is added — this measures what the non-group content ACTUALLY
  // occupies now that it is rendered, and re-paginates once with the true
  // figure.
  //
  // Bounded by `corrections`: a measurement that feeds back into the layout it
  // measures can oscillate, and two passes is enough to settle a value that
  // only depends on a fixed bar plus a fixed line of text. After that it stops
  // and lives with a page that is a few pixels generous.
  useLayoutEffect(() => {
    if (pages === null || pages.length <= 1) return
    const host = hostRef.current
    const scroller = host?.closest('.sheet-scroll') as HTMLElement | null
    if (!host || !scroller) return
    if (corrections.current >= MAX_RESERVE_CORRECTIONS) return

    const hostH = host.getBoundingClientRect().height
    const actual = Math.round(scroller.scrollHeight - hostH)
    if (Math.abs(actual - reserve) <= RESERVE_TOLERANCE_PX) return

    corrections.current += 1
    setReserve(actual)
    setPages(null)
    setPageHeight(null)
  }, [pages, reserve])

  // A content change starts the correction budget over — a different order can
  // legitimately need a different reserve.
  useLayoutEffect(() => { corrections.current = 0 }, [signature])

  // First pass, and the fits-on-one-page case: render everything plainly.
  const measuring = pages === null
  const single = pages !== null && pages.length <= 1
  const visible = measuring || single
    ? groups.map((_, i) => i)
    : (pages[Math.min(page, pages.length - 1)] ?? [])

  const total = pages?.length ?? 1
  const current = Math.min(page, total - 1)

  return (
    <>
      <div
        ref={hostRef}
        className="cart-readout-pagehost"
        style={pageHeight !== null && !measuring && total > 1 ? { minHeight: pageHeight } : undefined}
      >
        {visible.map((i) => (
          <ReadoutGroup
            key={groups[i].diner?.id ?? '~table'}
            group={groups[i]}
            lang={lang}
            split={split}
          />
        ))}
      </div>

      {!measuring && total > 1 && (
        <div className="cart-pager">
          <button
            type="button" className="cart-pager-btn press"
            onClick={() => { haptic('tick'); setPage((p) => Math.max(0, p - 1)) }}
            disabled={current === 0}
          >
            {CART_UI.prevPage[lang]}
          </button>

          <span
            className="cart-pager-count"
            aria-label={`${CART_UI.page[lang]} ${current + 1} ${CART_UI.pageOfMid[lang]} ${total}`}
          >
            {/* LTR: an arithmetic expression, not a sentence. */}
            <span dir="ltr">{current + 1} / {total}</span>
          </span>

          <button
            type="button" className="cart-pager-btn press"
            onClick={() => { haptic('tick'); setPage((p) => Math.min(total - 1, p + 1)) }}
            disabled={current === total - 1}
          >
            {CART_UI.nextPage[lang]}
          </button>
        </div>
      )}

      {!measuring && total > 1 && (
        <p className="cart-foot-note" style={{ margin: '2px 0 0', textAlign: 'center' }}>
          {CART_UI.photoHint[lang]}
        </p>
      )}
    </>
  )
}

/** Height held back for the pager bar during measurement — it is not in the
 *  DOM yet on the pass that decides whether it will be needed. */
const PAGER_RESERVE_PX = 52

/** Below this, a scroller size change is reflow noise (a scrollbar arriving,
 *  a sub-pixel rounding difference) rather than a real layout change worth
 *  re-paginating for. */
const RESIZE_EPSILON_PX = 24

/** How close the estimated reserve has to be before it is left alone. */
const RESERVE_TOLERANCE_PX = 4

/** Ceiling on measure-adjust-remeasure rounds, so a layout that feeds back
 *  into its own measurement can never loop. */
const MAX_RESERVE_CORRECTIONS = 2

function ReadoutGroup({ group, lang, split }: { group: DinerGroup; lang: Lang; split: boolean }) {
  const colour = group.diner?.colour ?? TABLE_COLOUR
  return (
    // data-readout-group is what ReadoutPages measures to decide where the
    // page breaks fall. Keep it on the OUTERMOST element of a group, or the
    // measurement misses the border and padding and every page comes out one
    // group too tall.
    <section className="cart-readout-group" data-readout-group style={{ borderColor: `${colour}66` }}>
      {split && (
        <h3 className="cart-readout-name" style={{ display: 'flex', alignItems: 'baseline', gap: 10, color: colour }}>
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
