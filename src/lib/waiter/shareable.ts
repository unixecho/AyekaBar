// Which items may be put on the whole table, and which must belong to one
// person. Requirement §12 — and the brief is explicit that this must be
// "enforced by the application UI/logic rather than relying on waiter memory".
//
// Everything here is PURE. The UI reads these rules; it never restates them.
// Exercised by scripts/check-shareable.mjs (no test runner in this project —
// same logic-harness pattern as the menu/access/happy-hour suites).
//
// ── Where the rules come from ─────────────────────────────────────────
// The owner's list, mapped onto the REAL category ids in public.public_menus
// (verified against the live menu, not the bundled snapshot):
//
//   כל הראשונות      → starters        whole category
//   פיצות            → pizzas          whole category
//   חגיגה על השולחן  → celebration     whole category
//   ליד הבירה        → barSnacks       whole category
//   נרגילה           → hookah          whole category
//   סנוקר            → snooker         whole category
//   לחם הבית         → ONE item in `oven` (uid hbgmzqpu21) — the rest of
//                       חם מהתנור is not shareable, so this is by uid
//   קוקטיילים        → cocktails, ONLY the קנקן (pitcher) variant
//   קנקן לימונענע    → the קנקן variant of `לימונענע` in combos
//   צ'ייסרים         → chasers + premiumChasers, ONLY at qty 4
//
// The last two are not special cases. A jug is a jug: any variant the menu
// labels קנקן is shareable, which covers cocktails AND combos (that is what
// "קנקן לימונענע" *is* — combos item tna8244qw0 at price "28/48"). Matching on
// the label the menu already produces means a new jug item on the menu is
// handled without touching this file.

import type { MenuItem, Localized } from '@/lib/menu/types'

/* ── Variants ─────────────────────────────────────────────────────────
   The public menu stores a dual price as one string ("52/208"). A waiter
   cannot tap a string — they need two prices with names. Which of the two a
   line uses is also what decides the cocktail/jug rule, so the split lives
   here rather than in a component.

   ⚠️ The LABELS are per-category and were originally inferred from price
   ratios (beer 30→34 is a size step, wine 49→139 is glass→bottle, cocktail
   52→208 is single→pitcher). The owner's own shareable list independently
   confirms the combos/cocktail reading — "קנקן לימונענע" is exactly the
   second variant of a 28/48 combos item — so the jug rule below rests on
   confirmed ground, not on the ratio guess. */

export interface LineVariant {
  /** Index into the item's price string. 0 = first, 1 = second. */
  index: number
  label: Localized
  price: number
}

const JUG_HE = 'קנקן'

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
    { he: JUG_HE, en: 'Pitcher', ar: 'إبريق' },
  ],
  combos: [
    { he: 'כוס', en: 'Glass', ar: 'كأس' },
    { he: JUG_HE, en: 'Pitcher', ar: 'إبريق' },
  ],
}

const FALLBACK_LABELS: [Localized, Localized] = [
  { he: 'קטן', en: 'Small', ar: 'صغير' },
  { he: 'גדול', en: 'Large', ar: 'كبير' },
]

/** One entry = a plain item. Two = the waiter must choose. Empty = no price. */
export function deriveVariants(item: MenuItem, categoryId: string): LineVariant[] {
  const p = item.price
  if (p === null || p === undefined || p === '') return []
  if (typeof p === 'number') return [{ index: 0, label: {}, price: p }]

  const parts = String(p).split('/').map((s) => Number(s.trim()))
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    const labels = VARIANT_LABELS[categoryId] ?? FALLBACK_LABELS
    return [
      { index: 0, label: labels[0], price: parts[0] },
      { index: 1, label: labels[1], price: parts[1] },
    ]
  }
  const single = Number(p)
  return Number.isFinite(single) ? [{ index: 0, label: {}, price: single }] : []
}

/** True when this variant is a pitcher/jug — the thing that makes a cocktail
 *  or a combo shareable. Reads the label, so it needs no per-item list. */
export const isJug = (v: LineVariant | null | undefined): boolean =>
  !!v && v.label.he === JUG_HE

/* ── Quantity rules ───────────────────────────────────────────────── */

/** Chasers come as a single or as a round of four. Nothing in between — §12
 *  and §17.16. Both chaser categories are in scope (₪18 and ₪22 lists). */
export const CHASER_CATEGORIES = ['chasers', 'premiumChasers'] as const

/** Allowed quantities for a category. `null` = any positive integer.
 *  The UI must render this as the choices themselves (two buttons for
 *  chasers), never a free stepper it then validates. */
export function allowedQuantities(categoryId: string): number[] | null {
  return (CHASER_CATEGORIES as readonly string[]).includes(categoryId) ? [1, 4] : null
}

export function isQuantityAllowed(categoryId: string, qty: number): boolean {
  if (!Number.isInteger(qty) || qty < 1) return false
  const allowed = allowedQuantities(categoryId)
  return allowed ? allowed.includes(qty) : true
}

/* ── Shareability ─────────────────────────────────────────────────── */

/** Categories shareable in their entirety. */
export const SHAREABLE_CATEGORIES = [
  'starters',     // כל הראשונות
  'pizzas',       // פיצות
  'celebration',  // חגיגה על השולחן — entire category
  'barSnacks',    // ליד הבירה
  'hookah',       // נרגילה
  'snooker',      // סנוקר
] as const

/** Shareable single items whose category is not. Keyed by the menu's stable
 *  `uid` (minted by ensureUids, migration 013) — never by name, which the
 *  owner can edit in the editor at any time. */
export const SHAREABLE_ITEM_UIDS: Record<string, string> = {
  hbgmzqpu21: 'לחם הבית', // category `oven`; the toasts beside it are not shared
}

export interface LineContext {
  categoryId: string
  itemUid: string | undefined
  variant: LineVariant | null
  qty: number
}

/**
 * May this line be put on the table rather than on a person?
 *
 * Note what is NOT here: nothing checks stock or availability. Per the owner,
 * stock is effectively infinite for now — sold-out is the menu editor's
 * `available` flag and is a separate concern from sharing.
 */
export function canShare({ categoryId, itemUid, variant, qty }: LineContext): boolean {
  // A round of four chasers is the table's; a single chaser is a person's.
  // Checked first: it must beat any category rule.
  if ((CHASER_CATEGORIES as readonly string[]).includes(categoryId)) return qty === 4

  if ((SHAREABLE_CATEGORIES as readonly string[]).includes(categoryId)) return true
  if (itemUid && itemUid in SHAREABLE_ITEM_UIDS) return true

  // A jug of anything — cocktails and combos both. A single cocktail is a
  // person's drink (§12: "A single individual cocktail must be assigned to a
  // specific customer").
  if (isJug(variant)) return true

  return false
}

/** What the UI should pre-select when the item is added. Shareable things are
 *  usually genuinely for the table, so defaulting to shared saves the taps —
 *  but the waiter can always move it to a person. */
export function defaultsToShared(ctx: LineContext): boolean {
  return canShare(ctx)
}

export type LineProblem =
  | { ok: true }
  | { ok: false; reason: 'qty'; message: Localized }
  | { ok: false; reason: 'not-shareable'; message: Localized }

/**
 * The one gate every write goes through. Call it in the UI to disable the
 * control, and again server-side before the row is written — the client is
 * never the last word on a rule.
 */
export function validateLine(
  ctx: LineContext,
  isShared: boolean,
): LineProblem {
  if (!isQuantityAllowed(ctx.categoryId, ctx.qty)) {
    const allowed = allowedQuantities(ctx.categoryId)
    const list = allowed ? allowed.join(' / ') : ''
    return {
      ok: false,
      reason: 'qty',
      message: {
        he: `כמות לא חוקית. אפשר ${list} בלבד.`,
        en: `Invalid quantity. Only ${list} allowed.`,
        ar: `كمية غير صالحة. ${list} فقط.`,
      },
    }
  }
  if (isShared && !canShare(ctx)) {
    return {
      ok: false,
      reason: 'not-shareable',
      message: {
        he: 'הפריט הזה משויך ללקוח מסוים, לא לשולחן.',
        en: 'This item belongs to a specific customer, not the table.',
        ar: 'هذا الصنف يخص زبوناً محدداً، لا الطاولة.',
      },
    }
  }
  return { ok: true }
}
