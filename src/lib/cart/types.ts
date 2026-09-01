// The customer's own order-building cart, on the customer's own phone.
//
// PHASE 1 IS LOCAL AND ONLY LOCAL. Nothing in this module is transmitted
// anywhere — see PLAN_MENU_CART.md §2 for why that was the deliberate call
// rather than a shortcut. The shapes below are nevertheless chosen to mirror
// the OMS's own order model (`waiter_order_items`, `waiter_orders.seats`) so
// that Phase 2 — a waiter-verified submission — is a field mapping and not a
// redesign. `lib/cart/submission.ts` is that mapping, written and tested now
// precisely so the shape can't drift before it has a consumer.
//
// WHERE THIS DEVIATES FROM THE PLAN, AND WHY
// PLAN_MENU_CART.md §3 sketched a line as carrying `price: MenuItem['price']`
// — i.e. the raw menu value, which may be a number OR a range string
// ("52/208"). Two problems showed up the moment it met the real OMS:
//   1. `waiter_order_items.unit_agorot` is a NOT NULL integer. A range string
//      can never become one without a human choosing which end of the range
//      was actually sold, so a cart storing the raw string just defers the
//      decision to a place with less information than the customer had.
//   2. ayeka-staff already solves this: `toVariants()` splits "52/208" into
//      two priced, labelled choices ("יחיד" / "קנקן") and the waiter taps one.
//      A customer who can't make that same choice builds a cart whose total is
//      wrong by construction.
// So a line stores `unitAgorot` (integer agorot, the house money rule) plus a
// `priceText` snapshot for display, and the customer picks the variant exactly
// as the waiter does — `lib/cart/variants.ts` is the twin of that function.
// The plan's fallback still exists for a price string neither of us can parse
// ("מ-40", "לפי משקל"): `unitAgorot` is null, the line shows its text, and it
// is excluded from the running total rather than guessed at.

import type { Localized } from '@/lib/menu/types'

/** One chosen option, snapshotted. Field-for-field the shape
 *  `waiter_order_items.selected_options` already stores (migration 029) —
 *  `{"groupId":"sauce","choiceId":"pesto","label":{...}}` — plus the group's
 *  own label, which the cart sheet needs to render "רוטב: פסטו" without a
 *  lookup back into a menu that may have been republished since. */
export interface CartOptionChoice {
  groupId: string
  choiceId: string
  label: Localized
  groupLabel: Localized
}

/** A named person at the table. The OMS's `waiter_orders.seats` is
 *  `[{"id":"a1","name":"דנה"}]` — the same two fields, deliberately. */
export interface CartDiner {
  id: string
  name: string
}

export interface CartLine {
  id: string
  /** The menu item's stable uid (`ensureUids()` in the editor). The one field
   *  that survives a menu republish, which is why the OMS keys on it too. */
  itemUid: string
  /** Snapshot at add-time, all three languages. The menu can be republished
   *  mid-visit; a customer's cart must not silently rename itself. */
  name: Localized
  /** Which end of a two-price item this is — "כוס"/"בקבוק". Empty object for
   *  a single-priced item, matching ayeka-staff's `Variant.label`. */
  variantLabel: Localized
  /** Index into the parsed variant list. Kept so that re-adding the same
   *  choice merges onto the existing line instead of stacking duplicates. */
  variantIndex: number
  /** Integer agorot (1 ₪ = 100 agorot). NEVER a float — the house rule, and
   *  what `waiter_order_items.unit_agorot` stores. Null only when the menu's
   *  price could not be resolved to a number at all. */
  unitAgorot: number | null
  /** What the menu showed, verbatim, for display next to an unpriced line. */
  priceText: string
  qty: number
  selectedOptions: CartOptionChoice[]
  /** null = "לשולחן" — for the table, not a person. Exactly what a null
   *  `waiter_order_items.seat_name` means today. */
  dinerId: string | null
  note?: string
  /** Snapshotted for the same reason the OMS snapshots category_id/title on
   *  an order item: it is what routes a line to the bar or the kitchen
   *  (`stationFor()` in ayeka-staff/src/shareable.ts). */
  categoryId: string
  categoryTitle: Localized
  /** Set only when the line was added while Happy Hour was running, and equal
   *  to the percentage that produced `unitAgorot`.
   *
   *  WHY IT IS WORTH A FIELD. `applyHappyHour()` rewrites `item.price` before
   *  the menu row renders, so a cart built at 18:00 snapshots discounted
   *  prices — correctly, that IS what the customer was shown. But Happy Hour
   *  ends at 20:00 and the bill does not honour it retroactively, so without
   *  this the cart quietly becomes a promise the bar will not keep, and the
   *  disagreement surfaces at the register. Tagging the line means the
   *  customer and the waiter can both see WHY it is cheaper, in one glance,
   *  before anyone is annoyed. The footer's "this total is for reference"
   *  line is the safety net; this is the explanation. */
  happyHourPercent?: number
  /** Epoch ms. Orders the sheet, and lets the menu-row stepper's "−" undo the
   *  most recent add rather than an arbitrary line. */
  addedAt: number
}

export interface Cart {
  diners: CartDiner[]
  lines: CartLine[]
}

export const EMPTY_CART: Cart = { diners: [], lines: [] }

// ── Limits ────────────────────────────────────────────────────────────
// Enforced by the reducer AND re-enforced by the storage sanitizer, because
// localStorage is editable by whoever holds the phone. Today that only
// protects the page from rendering 10,000 rows; from Phase 2 on it is the
// first of two validation layers on data that reaches a server, so it is
// written to that standard now rather than retrofitted (PLAN_MENU_CART §8).

/** A table ordering 60 distinct lines has stopped using this as a memory aid. */
export const MAX_LINES = 60
/** The bar's largest table is 12 (waiter_tables.seats), so is this. */
export const MAX_DINERS = 12
/** Per line. Twelve people can't share 30 of one thing without the waiter. */
export const MAX_QTY = 30
export const MAX_NAME_LEN = 24
export const MAX_NOTE_LEN = 120

/** localStorage key. Versioned in the key itself, not inside the payload, so
 *  a future v2 with an incompatible shape simply doesn't find a v1 cart —
 *  no migration code, no half-parsed state. */
export const CART_STORAGE_KEY = 'ayeka.menu.cart.v1'

/** A cart is a single visit. Eight hours covers the longest night and still
 *  means tomorrow's customer doesn't reopen the menu to last week's round.
 *  Checked on read; an expired cart is dropped, not shown and then cleared. */
export const CART_TTL_MS = 8 * 60 * 60 * 1000

/** What actually lands in localStorage. `savedAt` drives the TTL above. */
export interface StoredCart {
  savedAt: number
  cart: Cart
  /** Has the cart button ever been summoned? Persisted because the button
   *  must not pop into existence a second time when a returning customer
   *  reloads the page with a cart already in it (PLAN_MENU_CART §4.3). */
  summoned: boolean
}
