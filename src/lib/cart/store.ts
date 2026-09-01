// The cart's whole brain, as pure functions.
//
// No React, no localStorage, no DOM. Same reason `lib/shifts/store.ts` is
// shaped this way: the rules that decide what a customer's order IS are the
// part that must never be debugged through a UI, so they run headless in
// `scripts/check-cart.mjs` instead. The provider is a thin shell that calls
// `reduce()` and re-renders.
//
// Every function returns a NEW cart; nothing here mutates its input.

import {
  MAX_DINERS, MAX_LINES, MAX_NAME_LEN, MAX_NOTE_LEN, MAX_QTY,
  type Cart, type CartDiner, type CartLine, type CartOptionChoice,
} from './types'

// ── Side-effect seam ─────────────────────────────────────────────────
// Ids and clock readings are the only two impure things a cart edit needs.
// Injected so the harness can run the reducer deterministically, and so the
// id strategy can be swapped without touching the rules.

export interface ReduceCtx {
  newId: () => string
  now: () => number
}

let seq = 0

/** `crypto.randomUUID()` where it exists (every browser this app supports over
 *  https), a counter+random fallback where it doesn't — an iOS Safari older
 *  than 15.4, or a plain `node` process running the harness. These ids never
 *  leave the device in Phase 1 and are re-minted server-side in Phase 2, so
 *  they need to be unique within one cart, not globally unguessable. */
export function newId(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  seq += 1
  return `l${seq.toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export const defaultCtx: ReduceCtx = { newId, now: () => Date.now() }

// ── Actions ───────────────────────────────────────────────────────────

/** Everything needed to create a line, minus the parts the reducer mints. */
export interface AddPayload {
  itemUid: string
  name: CartLine['name']
  variantLabel: CartLine['variantLabel']
  variantIndex: number
  unitAgorot: number | null
  priceText: string
  categoryId: string
  categoryTitle: CartLine['categoryTitle']
  selectedOptions?: CartOptionChoice[]
  dinerId?: string | null
  qty?: number
  note?: string
  happyHourPercent?: number
}

export type CartAction =
  | { type: 'add'; payload: AddPayload }
  | { type: 'setQty'; lineId: string; qty: number }
  | { type: 'removeLine'; lineId: string }
  /** The menu row's "−". Removes one unit from the item's most recently
   *  added line — "undo my last tap", which is the only reading a stepper
   *  sitting on a menu row can honestly support once the same item exists
   *  in the cart two or three times under different names. Precise editing
   *  is what the cart sheet is for. */
  | { type: 'decrementItem'; itemUid: string }
  | { type: 'assignLine'; lineId: string; dinerId: string | null }
  | { type: 'setNote'; lineId: string; note: string }
  | { type: 'addDiner'; name: string }
  | { type: 'renameDiner'; dinerId: string; name: string }
  | { type: 'removeDiner'; dinerId: string }
  | { type: 'clear' }

// ── Helpers ───────────────────────────────────────────────────────────

export function clampQty(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v)) return 1
  return Math.min(MAX_QTY, Math.max(1, v))
}

export function clampText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  // Collapse whitespace before measuring, so "a" + 200 spaces isn't a
  // 24-character name, and so a pasted newline can't break a single-line row.
  return raw.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Two lines merge when every single thing about them matches. Options are
 *  compared as a SORTED signature, because the sheet renders groups in menu
 *  order but nothing guarantees a future caller will. */
function optionSignature(options: CartOptionChoice[]): string {
  return options
    .map((o) => `${o.groupId}=${o.choiceId}`)
    .sort()
    .join('|')
}

export function lineSignature(line: {
  itemUid: string; variantIndex: number; dinerId: string | null
  unitAgorot: number | null
  note?: string; selectedOptions: CartOptionChoice[]
}): string {
  // JSON rather than a joined string: a note is free text and could contain
  // whichever separator we picked, which would let two genuinely different
  // lines produce the same signature and silently merge into one.
  return JSON.stringify([
    line.itemUid,
    line.variantIndex,
    line.dinerId,
    // THE PRICE IS PART OF A LINE'S IDENTITY, not just the item. Happy Hour
    // ends at 20:00; the same beer added at 19:55 and at 20:05 was shown at
    // two different prices, and folding them together would silently re-price
    // the earlier one. Two lines, two prices, both true.
    line.unitAgorot,
    line.note ?? '',
    optionSignature(line.selectedOptions),
  ])
}

// ── The reducer ───────────────────────────────────────────────────────

export function reduce(cart: Cart, action: CartAction, ctx: ReduceCtx = defaultCtx): Cart {
  switch (action.type) {
    case 'add': {
      const p = action.payload
      if (!p.itemUid) return cart

      const dinerId = p.dinerId && cart.diners.some((d) => d.id === p.dinerId) ? p.dinerId : null
      const note = clampText(p.note, MAX_NOTE_LEN)
      const selectedOptions = (p.selectedOptions ?? []).slice(0, 8)
      const addQty = clampQty(p.qty ?? 1)

      const sig = lineSignature({
        itemUid: p.itemUid,
        variantIndex: p.variantIndex,
        dinerId,
        unitAgorot: p.unitAgorot,
        note: note || undefined,
        selectedOptions,
      })

      const existing = cart.lines.findIndex((l) => lineSignature(l) === sig)
      if (existing !== -1) {
        const lines = cart.lines.slice()
        const line = lines[existing]
        const nextQty = Math.min(MAX_QTY, line.qty + addQty)
        // Silently capping at MAX_QTY and also bumping addedAt would make a
        // no-op tap reorder the sheet. Only touch addedAt when something
        // actually changed.
        if (nextQty === line.qty) return cart
        lines[existing] = { ...line, qty: nextQty, addedAt: ctx.now() }
        return { ...cart, lines }
      }

      if (cart.lines.length >= MAX_LINES) return cart

      const line: CartLine = {
        id: ctx.newId(),
        itemUid: p.itemUid,
        name: p.name,
        variantLabel: p.variantLabel,
        variantIndex: p.variantIndex,
        unitAgorot: p.unitAgorot,
        priceText: p.priceText,
        qty: addQty,
        selectedOptions,
        dinerId,
        categoryId: p.categoryId,
        categoryTitle: p.categoryTitle,
        addedAt: ctx.now(),
        ...(note ? { note } : {}),
        ...(typeof p.happyHourPercent === 'number' && p.happyHourPercent > 0
          ? { happyHourPercent: p.happyHourPercent }
          : {}),
      }
      return { ...cart, lines: [...cart.lines, line] }
    }

    case 'setQty': {
      const qty = Math.floor(Number(action.qty))
      if (Number.isFinite(qty) && qty <= 0) {
        return reduce(cart, { type: 'removeLine', lineId: action.lineId }, ctx)
      }
      const next = clampQty(qty)
      const lines = cart.lines.map((l) => (l.id === action.lineId ? { ...l, qty: next } : l))
      return { ...cart, lines }
    }

    case 'removeLine':
      return { ...cart, lines: cart.lines.filter((l) => l.id !== action.lineId) }

    case 'decrementItem': {
      const candidates = cart.lines.filter((l) => l.itemUid === action.itemUid)
      if (!candidates.length) return cart
      // Most recent wins; ties broken by array position so the result is
      // deterministic even when two adds land in the same millisecond.
      let target = candidates[0]
      for (const l of candidates) if (l.addedAt >= target.addedAt) target = l
      return target.qty > 1
        ? reduce(cart, { type: 'setQty', lineId: target.id, qty: target.qty - 1 }, ctx)
        : reduce(cart, { type: 'removeLine', lineId: target.id }, ctx)
    }

    case 'assignLine': {
      const dinerId =
        action.dinerId && cart.diners.some((d) => d.id === action.dinerId) ? action.dinerId : null
      const moved = cart.lines.find((l) => l.id === action.lineId)
      if (!moved || moved.dinerId === dinerId) return cart

      // Reassigning can make a line identical to one that already exists on
      // the destination — same drink, same options, now the same person. Fold
      // them together rather than showing "בירה ×1" twice under one name.
      const nextLine = { ...moved, dinerId }
      const sig = lineSignature(nextLine)
      const twin = cart.lines.find((l) => l.id !== moved.id && lineSignature(l) === sig)

      if (twin) {
        const merged = Math.min(MAX_QTY, twin.qty + moved.qty)
        return {
          ...cart,
          lines: cart.lines
            .filter((l) => l.id !== moved.id)
            .map((l) => (l.id === twin.id ? { ...l, qty: merged } : l)),
        }
      }
      return { ...cart, lines: cart.lines.map((l) => (l.id === moved.id ? nextLine : l)) }
    }

    case 'setNote': {
      const note = clampText(action.note, MAX_NOTE_LEN)
      const lines = cart.lines.map((l) =>
        l.id === action.lineId ? { ...l, ...(note ? { note } : { note: undefined }) } : l,
      )
      return { ...cart, lines }
    }

    case 'addDiner': {
      const name = clampText(action.name, MAX_NAME_LEN)
      if (!name) return cart
      if (cart.diners.length >= MAX_DINERS) return cart
      // Two people called "דנה" at one table is a real thing; two rows called
      // "דנה" in a splitting UI is not usable. Reject the exact duplicate and
      // let the customer disambiguate ("דנה ק").
      if (cart.diners.some((d) => d.name === name)) return cart
      return { ...cart, diners: [...cart.diners, { id: ctx.newId(), name }] }
    }

    case 'renameDiner': {
      const name = clampText(action.name, MAX_NAME_LEN)
      if (!name) return cart
      if (cart.diners.some((d) => d.id !== action.dinerId && d.name === name)) return cart
      return {
        ...cart,
        diners: cart.diners.map((d) => (d.id === action.dinerId ? { ...d, name } : d)),
      }
    }

    case 'removeDiner': {
      if (!cart.diners.some((d) => d.id === action.dinerId)) return cart
      // Their lines go back to the table — never deleted. Someone leaving the
      // split is not the same as their drink being cancelled, and silently
      // discarding what a customer built is the one unforgivable bug in a
      // cart (PLAN_MENU_CART §4.6).
      let next: Cart = { ...cart, diners: cart.diners.filter((d) => d.id !== action.dinerId) }
      for (const line of cart.lines) {
        if (line.dinerId === action.dinerId) {
          next = reduce(next, { type: 'assignLine', lineId: line.id, dinerId: null }, ctx)
        }
      }
      return next
    }

    case 'clear':
      return { diners: [], lines: [] }

    default:
      return cart
  }
}

// ── Selectors ─────────────────────────────────────────────────────────

/** Total units in the cart — the number on the button's badge. */
export function cartCount(cart: Cart): number {
  return cart.lines.reduce((n, l) => n + l.qty, 0)
}

/** How many of this menu item are in the cart, across every diner and every
 *  variant. What the menu row's stepper shows. */
export function qtyOfItem(cart: Cart, itemUid: string): number {
  return cart.lines.reduce((n, l) => (l.itemUid === itemUid ? n + l.qty : n), 0)
}

export interface CartTotals {
  /** Sum of everything that HAS a price. */
  agorot: number
  /** Lines whose price the menu didn't state as a number. Surfaced, never
   *  folded into the total as a guess (PLAN_MENU_CART §4.7). */
  unpricedLines: number
}

export function totals(lines: CartLine[]): CartTotals {
  let agorot = 0
  let unpricedLines = 0
  for (const l of lines) {
    if (l.unitAgorot === null) unpricedLines += 1
    else agorot += l.unitAgorot * l.qty
  }
  return { agorot, unpricedLines }
}

export function cartTotals(cart: Cart): CartTotals {
  return totals(cart.lines)
}

export interface DinerGroup {
  /** null = the "לשולחן" group, which always exists and always comes first. */
  diner: CartDiner | null
  lines: CartLine[]
  totals: CartTotals
}

/**
 * The sheet's whole layout, in one pass: the table's own lines first, then one
 * section per diner in the order they were named. A diner with nothing yet
 * still gets a section — that empty row is how you see that you named someone
 * and haven't ordered for them.
 */
export function groupByDiner(cart: Cart): DinerGroup[] {
  const byDiner = new Map<string, CartLine[]>()
  const table: CartLine[] = []
  for (const line of cart.lines) {
    if (line.dinerId === null) { table.push(line); continue }
    const bucket = byDiner.get(line.dinerId)
    if (bucket) bucket.push(line)
    else byDiner.set(line.dinerId, [line])
  }

  const groups: DinerGroup[] = [{ diner: null, lines: table, totals: totals(table) }]
  for (const diner of cart.diners) {
    const lines = byDiner.get(diner.id) ?? []
    groups.push({ diner, lines, totals: totals(lines) })
  }
  return groups
}
