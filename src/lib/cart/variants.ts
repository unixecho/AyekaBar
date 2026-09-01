// Turning a menu price into something a customer can actually tap.
//
// ⚠️ TWIN FILE. The parsing rules and the label table below are a port of
// `toVariants()` + `VARIANT_LABELS` in `ayeka-staff/src/menu.ts`. They must
// stay identical: a customer picking "קנקן" on this page and the waiter
// picking "קנקן" on theirs have to mean the same 208₪, or the cart the
// customer reads out and the order the waiter registers disagree — which is
// the exact failure this whole feature exists to prevent. Same discipline as
// `lib/waiter/grid.ts` ↔ `ayeka-staff/src/grid.ts`; change one, change both.
//
// THE UNDERLYING PROBLEM. The menu stores a dual price as one opaque string
// ("30/34", "49/139", "52/208") with nothing saying what the two numbers are.
// It differs per category and the ratio gives it away: beer 30→34 is a size
// step, wine 49→139 (~3×) is glass→bottle, cocktail 52→208 (4×) is
// single→pitcher. ayeka-staff's own header flags these labels as
// OWNER-UNCONFIRMED — they have been in front of waiters since 2026-08-15 but
// this is the first time they are in front of a paying customer, so it is on
// the handoff list for the owner to confirm. The PRICES are never guessed:
// they are exactly the two numbers the owner typed. A wrong label would be a
// wrong word next to a right price, and the customer sees both.

import type { Localized } from '@/lib/menu/types'

export interface PriceVariant {
  /** Empty object for a single-priced item — nothing to disambiguate. */
  label: Localized
  /** Integer agorot. */
  agorot: number
}

const VARIANT_LABELS: Record<string, [Localized, Localized]> = {
  draftBeer: [
    { he: 'שליש', en: '1/3', ar: 'ثلث' },
    { he: 'חצי', en: '1/2', ar: 'نصف' },
  ],
  wines: [
    { he: 'כוס', en: 'Glass', ar: 'كأس' },
    { he: 'בקבוק', en: 'Bottle', ar: 'زجاجة' },
  ],
  cocktails: [
    { he: 'יחיד', en: 'Single', ar: 'مفرد' },
    { he: 'קנקן', en: 'Pitcher', ar: 'إبريق' },
  ],
  combos: [
    { he: 'כוס', en: 'Glass', ar: 'كأس' },
    { he: 'קנקן', en: 'Pitcher', ar: 'إبريق' },
  ],
}

const FALLBACK_LABELS: [Localized, Localized] = [
  { he: 'קטן', en: 'Small', ar: 'صغير' },
  { he: 'גדול', en: 'Large', ar: 'كبير' },
]

/** ₪ → agorot. Rounded, never truncated: a menu price of 12.5 must become
 *  1250, and floating-point 12.5*100 is not reliably an integer for every
 *  value the owner might type. */
export function toAgorot(shekels: number): number {
  return Math.round(shekels * 100)
}

/** agorot → the string shown next to a price. Whole shekels lose the
 *  decimals (every price on this menu is whole today); a half-shekel keeps
 *  them rather than silently rounding money on screen. */
export function fmtAgorot(agorot: number): string {
  const whole = agorot / 100
  return Number.isInteger(whole) ? String(whole) : whole.toFixed(2)
}

/**
 * Every price a customer could tap for this item.
 *
 *   []            the price can't be resolved to a number at all — the item is
 *                 still addable, priced by the waiter, excluded from the total
 *   [one]         a plain item; no choice to make
 *   [a, b]        a dual-price item; the customer picks, exactly as the
 *                 waiter does in the OMS
 */
export function toVariants(
  price: number | string | null | undefined,
  categoryId: string,
): PriceVariant[] {
  if (price === null || price === undefined || price === '') return []
  if (typeof price === 'number') {
    return Number.isFinite(price) ? [{ label: {}, agorot: toAgorot(price) }] : []
  }

  const parts = String(price).split('/').map((p) => Number(p.trim()))
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    const labels = VARIANT_LABELS[categoryId] ?? FALLBACK_LABELS
    return [
      { label: labels[0], agorot: toAgorot(parts[0]) },
      { label: labels[1], agorot: toAgorot(parts[1]) },
    ]
  }

  const single = Number(price)
  return Number.isFinite(single) ? [{ label: {}, agorot: toAgorot(single) }] : []
}

/** Does adding this item require the customer to decide something first?
 *  Two prices, or any option group with real choices in it. */
export function needsChoice(
  variants: PriceVariant[],
  optionGroups: { choices: unknown[] }[] | undefined,
): boolean {
  if (variants.length > 1) return true
  return (optionGroups ?? []).some((g) => (g.choices?.length ?? 0) > 0)
}
