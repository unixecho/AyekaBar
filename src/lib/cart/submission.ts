// PHASE 2 GROUNDWORK — the bridge between a customer's cart and a real OMS
// order. Nothing calls this yet. It exists now, and is exercised by
// `scripts/check-cart.mjs`, for one reason: the cost of a cart shape that
// can't become `waiter_order_items` rows is only discovered on the day
// somebody tries, and by then the shape is in ten thousand customers'
// localStorage. Writing the mapping first is how the shape gets checked
// against reality while it is still free to change.
//
// ── THE FLOW THIS IS THE MIDDLE OF ───────────────────────────────────
//
//   1. Customer builds a cart on their own phone (Phase 1 — live today).
//   2. Waiter arrives, opens their app, taps "קוד לשולחן" and reads out a
//      6-digit code. See `lib/cart/otp.ts` for that half.
//   3. Customer types the code. The server verifies it, learns WHICH TABLE
//      this phone is sitting at (the code carries it), and opens a short-lived
//      table session.
//   4. Customer taps "שליחה למלצר". The client POSTs `CartSubmission` —
//      exactly the shape below.
//   5. The submission lands in `customer_cart_submissions` as PENDING. It is
//      NOT an order. Nothing is fired to the bar or the kitchen.
//   6. The waiter reviews it in their app and consciously imports it, at
//      which point `toOrderItemRows()` below is what the importer maps with.
//
// ── WHY STEP 5 IS A REVIEW QUEUE AND NOT A DIRECT WRITE ──────────────
// A customer double-tapping "+" or fat-fingering a quantity must not become a
// kitchen ticket, and unverified client input must never mint a billable line.
// The OMS already refuses to open an order without an active shift and a real
// role; a customer-submitted cart is strictly less trusted than that, so it
// gets strictly more human in the loop, not less.
//
// ── WHAT IS DELIBERATELY *NOT* HERE ──────────────────────────────────
// No prices are trusted from the client on import. `unit_agorot` below is the
// customer's SNAPSHOT — it is what they were shown, and it is worth keeping so
// the waiter can see "this person was quoted 52" if the menu changed since —
// but the importing side must re-price every line from the live menu by
// `item_uid` before writing. That is a note for the importer, and it is
// repeated on the field itself.

import { fmtAgorot } from './variants'
import { loc, type Lang } from '@/lib/menu/types'
import { totals } from './store'
import {
  MAX_DINERS, MAX_LINES, MAX_NAME_LEN, MAX_NOTE_LEN, MAX_QTY,
  type Cart, type CartLine,
} from './types'

/** One line, in the vocabulary `waiter_order_items` already speaks. Column
 *  names, not camelCase, on purpose — this object is meant to read as the row
 *  it becomes, so a mismatch is visible rather than buried in a mapper. */
export interface SubmissionItem {
  item_uid: string
  name_he: string
  name_en: string | null
  /** "כוס" / "קנקן" / "" — `waiter_order_items.variant`, same meaning. */
  variant: string
  /** THE CUSTOMER'S SNAPSHOT, NOT A PRICE TO BILL. Re-price from the live
   *  menu on import. Null when the menu never stated a number (a range the
   *  parser couldn't split, "לפי משקל") — those lines MUST be priced by a
   *  human, which is what `unpriced_count` below is for. */
  unit_agorot: number | null
  qty: number
  note: string | null
  category_id: string
  category_title: string
  /** null = for the table. Exactly `waiter_order_items.seat_name`'s own
   *  meaning — this is the field the whole diner model was shaped around. */
  seat_name: string | null
  /** `waiter_order_items.selected_options`' shape verbatim (migration 029). */
  selected_options: { groupId: string; choiceId: string; label: Record<string, string> }[]
}

export interface CartSubmission {
  /** Bumped only for an incompatible change. The server must reject a version
   *  it doesn't know rather than best-effort a payload it can't read. */
  version: 1
  /** The language the customer was reading. Not decoration: it decides which
   *  name the waiter's screen should lead with when the two disagree. */
  lang: Lang
  diners: { id: string; name: string }[]
  items: SubmissionItem[]
  /** Sum of the priced lines, in agorot, as the customer saw it. Sent so the
   *  waiter can spot a menu change between building and sending — never used
   *  as the amount to charge. */
  total_agorot: number
  /** How many lines have no machine-readable price. Non-zero means a human
   *  must set a price before this can be imported; the review UI leads with
   *  it rather than letting it be discovered at the register. */
  unpriced_count: number
}

/** Build the wire payload from a live cart. Pure. */
export function toSubmission(cart: Cart, lang: Lang): CartSubmission {
  const dinerName = new Map<string, string>()
  for (const d of cart.diners) dinerName.set(d.id, d.name)

  const { agorot, unpricedLines } = totals(cart.lines)

  return {
    version: 1,
    lang,
    diners: cart.diners.map((d) => ({ id: d.id, name: d.name })),
    items: cart.lines.map((l) => toSubmissionItem(l, dinerName)),
    total_agorot: agorot,
    unpriced_count: unpricedLines,
  }
}

function toSubmissionItem(line: CartLine, dinerName: Map<string, string>): SubmissionItem {
  // `seat_name` is the NAME, not the id — the OMS snapshots the name so a
  // guest list edited later never rewrites history. Same rule here.
  const seat = line.dinerId ? dinerName.get(line.dinerId) ?? null : null
  return {
    item_uid: line.itemUid,
    // name_he is NOT NULL in the schema. Fall through the same he→en→ar chain
    // the rest of the site uses rather than sending an empty string.
    name_he: loc(line.name, 'he') || loc(line.name, 'en') || line.itemUid,
    name_en: line.name.en ?? null,
    variant: loc(line.variantLabel, 'he'),
    unit_agorot: line.unitAgorot,
    qty: line.qty,
    note: line.note ?? null,
    category_id: line.categoryId,
    category_title: loc(line.categoryTitle, 'he'),
    seat_name: seat,
    selected_options: line.selectedOptions.map((o) => ({
      groupId: o.groupId,
      choiceId: o.choiceId,
      label: { ...o.label },
    })),
  }
}

/**
 * Server-side validation of a submission that arrived over the wire.
 *
 * A CLIENT-SIDE SANITIZER IS NOT VALIDATION. `storage.ts`'s `sanitizeCart()`
 * protects this app's own rendering from a corrupt localStorage entry; it
 * runs on the attacker's machine and proves nothing. This function is the
 * independent server-side half, and the future route must call it before the
 * payload touches anything — same posture every other write path in this repo
 * already takes (`/api/owner/settings` re-checks every field it stores rather
 * than trusting the editor that sent it).
 *
 * Returns a REASON on failure, in Hebrew, because the reason is shown to a
 * customer standing at a table, not written to a log nobody reads.
 */
export function validateSubmission(
  input: unknown,
): { ok: true; value: CartSubmission } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'הזמנה לא תקינה' }
  }
  const src = input as Record<string, unknown>

  if (src.version !== 1) return { ok: false, error: 'גרסת הזמנה לא נתמכת' }
  const lang = src.lang
  if (lang !== 'he' && lang !== 'en' && lang !== 'ar') {
    return { ok: false, error: 'שפה לא תקינה' }
  }

  if (!Array.isArray(src.items) || src.items.length === 0) {
    return { ok: false, error: 'ההזמנה ריקה' }
  }
  if (src.items.length > MAX_LINES) return { ok: false, error: 'ההזמנה ארוכה מדי' }

  const diners: CartSubmission['diners'] = []
  if (src.diners !== undefined) {
    if (!Array.isArray(src.diners)) return { ok: false, error: 'רשימת הסועדים לא תקינה' }
    if (src.diners.length > MAX_DINERS) return { ok: false, error: 'יותר מדי סועדים' }
    for (const raw of src.diners) {
      if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'סועד לא תקין' }
      const d = raw as Record<string, unknown>
      if (typeof d.id !== 'string' || !d.id || d.id.length > 64) return { ok: false, error: 'סועד לא תקין' }
      if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > MAX_NAME_LEN) {
        return { ok: false, error: 'שם סועד לא תקין' }
      }
      diners.push({ id: d.id, name: d.name.trim() })
    }
  }

  const names = new Set(diners.map((d) => d.name))
  const items: SubmissionItem[] = []
  for (const raw of src.items) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'פריט לא תקין' }
    const i = raw as Record<string, unknown>

    if (typeof i.item_uid !== 'string' || !i.item_uid || i.item_uid.length > 128) {
      return { ok: false, error: 'פריט לא תקין' }
    }
    if (typeof i.name_he !== 'string' || !i.name_he.trim()) {
      return { ok: false, error: 'פריט ללא שם' }
    }
    const qty = Number(i.qty)
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok: false, error: 'כמות לא תקינה' }
    }
    const unit = i.unit_agorot
    if (unit !== null && (!Number.isInteger(unit) || (unit as number) < 0)) {
      return { ok: false, error: 'מחיר לא תקין' }
    }
    if (i.note !== null && i.note !== undefined && (typeof i.note !== 'string' || i.note.length > MAX_NOTE_LEN)) {
      return { ok: false, error: 'הערה ארוכה מדי' }
    }
    // A seat_name that matches nobody on the diner list would produce an order
    // item attributed to a person the table never named. Reject rather than
    // quietly reassigning it to the table — this arrived from a client, and
    // silently rewriting client data is how mismatches become invisible.
    if (i.seat_name !== null && i.seat_name !== undefined) {
      if (typeof i.seat_name !== 'string' || !names.has(i.seat_name)) {
        return { ok: false, error: 'שיוך לסועד לא תקין' }
      }
    }

    const options: SubmissionItem['selected_options'] = []
    if (i.selected_options !== undefined) {
      if (!Array.isArray(i.selected_options)) return { ok: false, error: 'אפשרויות לא תקינות' }
      if (i.selected_options.length > 8) return { ok: false, error: 'יותר מדי אפשרויות' }
      for (const o of i.selected_options) {
        if (typeof o !== 'object' || o === null) return { ok: false, error: 'אפשרויות לא תקינות' }
        const opt = o as Record<string, unknown>
        if (typeof opt.groupId !== 'string' || typeof opt.choiceId !== 'string') {
          return { ok: false, error: 'אפשרויות לא תקינות' }
        }
        if (opt.groupId.length > 64 || opt.choiceId.length > 64) {
          return { ok: false, error: 'אפשרויות לא תקינות' }
        }
        const label: Record<string, string> = {}
        if (typeof opt.label === 'object' && opt.label !== null) {
          for (const k of ['he', 'en', 'ar']) {
            const v = (opt.label as Record<string, unknown>)[k]
            if (typeof v === 'string') label[k] = v.slice(0, 200)
          }
        }
        options.push({ groupId: opt.groupId, choiceId: opt.choiceId, label })
      }
    }

    items.push({
      item_uid: i.item_uid,
      name_he: i.name_he.trim().slice(0, 200),
      name_en: typeof i.name_en === 'string' ? i.name_en.trim().slice(0, 200) || null : null,
      variant: typeof i.variant === 'string' ? i.variant.slice(0, 40) : '',
      unit_agorot: unit === null || unit === undefined ? null : (unit as number),
      qty,
      note: typeof i.note === 'string' && i.note.trim() ? i.note.trim() : null,
      category_id: typeof i.category_id === 'string' ? i.category_id.slice(0, 64) : '',
      category_title: typeof i.category_title === 'string' ? i.category_title.slice(0, 200) : '',
      seat_name: typeof i.seat_name === 'string' ? i.seat_name : null,
      selected_options: options,
    })
  }

  // Recomputed, never read from the payload: a total the client sent is a
  // number the client chose.
  const total_agorot = items.reduce(
    (sum, it) => sum + (it.unit_agorot === null ? 0 : it.unit_agorot * it.qty),
    0,
  )
  const unpriced_count = items.filter((it) => it.unit_agorot === null).length

  return { ok: true, value: { version: 1, lang, diners, items, total_agorot, unpriced_count } }
}

/**
 * A plain-text rendering of the order — one line per item, grouped by diner.
 *
 * Used today by nothing but tested from day one, because it is what the
 * "send by email" fallback channel prints (the owner's alternative to an SMS
 * gateway — see `lib/cart/otp.ts`), and what a waiter-facing review screen
 * shows above the import button.
 */
export function toPlainText(sub: CartSubmission): string {
  const out: string[] = []
  // The table's own lines are kept in their own array rather than under a
  // sentinel key in the map: any sentinel string is a string a diner could
  // legitimately be called, and a collision here would silently merge one
  // person's order into the table's.
  const tableLines: SubmissionItem[] = []
  const bySeat = new Map<string, SubmissionItem[]>()
  for (const it of sub.items) {
    if (it.seat_name === null) { tableLines.push(it); continue }
    const bucket = bySeat.get(it.seat_name)
    if (bucket) bucket.push(it)
    else bySeat.set(it.seat_name, [it])
  }

  const sections: [string, SubmissionItem[]][] = []
  if (tableLines.length) sections.push(['לשולחן', tableLines])
  for (const d of sub.diners) {
    const lines = bySeat.get(d.name)
    if (lines?.length) sections.push([d.name, lines])
  }

  for (const [title, lines] of sections) {
    out.push(`— ${title} —`)
    for (const it of lines) {
      const bits = [it.name_he]
      if (it.variant) bits.push(`(${it.variant})`)
      for (const o of it.selected_options) {
        const label = o.label.he || o.label.en || o.label.ar || o.choiceId
        bits.push(`· ${label}`)
      }
      const price = it.unit_agorot === null ? '—' : `${fmtAgorot(it.unit_agorot * it.qty)}₪`
      out.push(`${it.qty} × ${bits.join(' ')}   ${price}`)
      if (it.note) out.push(`    ↳ ${it.note}`)
    }
    out.push('')
  }

  out.push(`סה״כ: ${fmtAgorot(sub.total_agorot)}₪`)
  if (sub.unpriced_count > 0) out.push(`(${sub.unpriced_count} פריטים ללא מחיר קבוע)`)
  return out.join('\n')
}
