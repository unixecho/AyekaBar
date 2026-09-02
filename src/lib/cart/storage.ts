// localStorage persistence for the cart, and the validator that guards it.
//
// TWO REASONS THE SANITIZER IS THIS STRICT FOR A PHASE THAT SENDS NOTHING:
//
// 1. localStorage is not this app's memory, it is the DEVICE's. Anything can
//    be in there — a half-written value from a tab killed mid-write, a v1 cart
//    from a build three deploys ago, or a string somebody typed into devtools.
//    A cart page that throws on load is a menu that doesn't open, and the menu
//    is the product. So: parse defensively, keep what is well-formed, drop the
//    rest, and never let a bad byte reach React.
//
// 2. From Phase 2 on this exact structure is the body of a POST. Validation
//    written after an endpoint exists is validation written to match whatever
//    the client happens to send; written now, it is written to match what the
//    schema can actually accept. `sanitizeCart()` is the client-side half of
//    that pair and `submission.ts` is the wire half — the server will still
//    re-validate independently, because a client-side check protects the
//    client and nothing else.
//
// Note for the cookie-consent question (PLAYBOOK.md §3): this is first-party,
// strictly functional storage created only by a customer's own tap, holding no
// identifiers and reaching no third party. It is not the analytics/advertising
// category Amendment 13 requires a banner for, and it does not change the
// project's "no banner needed yet" status.

import {
  CART_STORAGE_KEY, CART_TUTORIAL_KEY, CART_TTL_MS, DINER_COLOURS, EMPTY_CART, MAX_DINERS, MAX_LINES,
  MAX_NAME_LEN, MAX_NOTE_LEN, MAX_QTY,
  type Cart, type CartDiner, type CartLine, type CartOptionChoice, type StoredCart,
} from './types'

const LANG_KEYS = ['he', 'en', 'ar'] as const

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || undefined
}

/** Keep only the three known language keys, each a bounded string. Anything
 *  else in the object is dropped — a Localized is not a free-form bag. */
function localized(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (typeof v !== 'object' || v === null) return out
  const src = v as Record<string, unknown>
  for (const k of LANG_KEYS) {
    const s = str(src[k], 200)
    if (s) out[k] = s
  }
  return out
}

function options(v: unknown): CartOptionChoice[] {
  if (!Array.isArray(v)) return []
  const out: CartOptionChoice[] = []
  for (const raw of v.slice(0, 8)) {
    if (typeof raw !== 'object' || raw === null) continue
    const o = raw as Record<string, unknown>
    const groupId = str(o.groupId, 64)
    const choiceId = str(o.choiceId, 64)
    if (!groupId || !choiceId) continue
    out.push({
      groupId,
      choiceId,
      label: localized(o.label),
      groupLabel: localized(o.groupLabel),
    })
  }
  return out
}

function agorot(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const n = Math.round(v)
  // A negative unit price is not a discount, it is a corrupt row. Money is
  // integer agorot and non-negative, matching the DB's own CHECK.
  if (n < 0 || n > 1_000_000) return null
  return n
}

/**
 * Turn anything at all into a valid Cart. Never throws, never returns
 * undefined, never returns a line the reducer or the UI could choke on.
 * Exported so `scripts/check-cart.mjs` can hammer it with garbage.
 */
export function sanitizeCart(input: unknown): Cart {
  if (typeof input !== 'object' || input === null) return EMPTY_CART
  const src = input as Record<string, unknown>

  const diners: CartDiner[] = []
  const seenDinerIds = new Set<string>()
  if (Array.isArray(src.diners)) {
    for (const raw of src.diners) {
      if (diners.length >= MAX_DINERS) break
      if (typeof raw !== 'object' || raw === null) continue
      const d = raw as Record<string, unknown>
      const id = str(d.id, 64)
      const name = str(d.name, MAX_NAME_LEN)
      if (!id || !name || seenDinerIds.has(id)) continue
      // The colour must be one WE chose. Accepting an arbitrary string here
      // would let a hand-edited localStorage entry put unvalidated text into a
      // style attribute, which is the shape of a CSS-injection bug even though
      // React would escape it today. An unrecognised value falls back to a
      // palette entry rather than being dropped, so the diner still renders.
      const rawColour = typeof d.colour === 'string' ? d.colour : ''
      const colour = DINER_COLOURS.includes(rawColour)
        ? rawColour
        : DINER_COLOURS[diners.length % DINER_COLOURS.length]
      seenDinerIds.add(id)
      diners.push({ id, name, colour })
    }
  }

  const lines: CartLine[] = []
  const seenLineIds = new Set<string>()
  if (Array.isArray(src.lines)) {
    for (const raw of src.lines) {
      if (lines.length >= MAX_LINES) break
      if (typeof raw !== 'object' || raw === null) continue
      const l = raw as Record<string, unknown>

      const id = str(l.id, 64)
      const itemUid = str(l.itemUid, 128)
      if (!id || !itemUid || seenLineIds.has(id)) continue

      const qtyRaw = Math.floor(Number(l.qty))
      if (!Number.isFinite(qtyRaw) || qtyRaw < 1) continue
      const qty = Math.min(MAX_QTY, qtyRaw)

      const variantIndexRaw = Math.floor(Number(l.variantIndex))
      const variantIndex = Number.isFinite(variantIndexRaw) && variantIndexRaw >= 0 ? variantIndexRaw : 0

      // A dinerId pointing at someone who is no longer in the list becomes
      // "לשולחן" rather than an orphan line that renders in no section at all.
      const dinerIdRaw = str(l.dinerId, 64)
      const dinerId = dinerIdRaw && seenDinerIds.has(dinerIdRaw) ? dinerIdRaw : null

      const addedAtRaw = Number(l.addedAt)
      const addedAt = Number.isFinite(addedAtRaw) && addedAtRaw > 0 ? addedAtRaw : 0

      const presentedRaw = Number(l.presentedAt)
      const presentedAt = Number.isFinite(presentedRaw) && presentedRaw > 0 ? presentedRaw : undefined

      // 1-90 mirrors the owner editor's own bound on a Happy Hour rule.
      // Anything else is dropped rather than clamped: an out-of-range value
      // is corrupt data, and a corrupt discount badge is worse than none.
      const hhRaw = Math.round(Number(l.happyHourPercent))
      const happyHourPercent = Number.isFinite(hhRaw) && hhRaw > 0 && hhRaw <= 90 ? hhRaw : undefined

      seenLineIds.add(id)
      const note = str(l.note, MAX_NOTE_LEN)
      lines.push({
        id,
        itemUid,
        name: localized(l.name),
        variantLabel: localized(l.variantLabel),
        variantIndex,
        unitAgorot: agorot(l.unitAgorot),
        priceText: str(l.priceText, 40) ?? '',
        qty,
        selectedOptions: options(l.selectedOptions),
        dinerId,
        categoryId: str(l.categoryId, 64) ?? '',
        categoryTitle: localized(l.categoryTitle),
        addedAt,
        ...(note ? { note } : {}),
        ...(happyHourPercent ? { happyHourPercent } : {}),
        ...(presentedAt ? { presentedAt } : {}),
      })
    }
  }

  return { diners, lines }
}

/** Read the saved cart. Returns nulls for "nothing usable here" — an expired
 *  cart, a private-mode tab that throws on access, a corrupt payload. The
 *  caller starts empty either way; nothing about this path is an error state
 *  worth showing a customer. */
export function loadCart(): { cart: Cart; summoned: boolean } {
  const empty = { cart: EMPTY_CART, summoned: false }
  if (typeof window === 'undefined') return empty
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as Partial<StoredCart> | null
    if (!parsed || typeof parsed !== 'object') return empty

    const savedAt = Number(parsed.savedAt)
    // A savedAt in the future (a device clock that was wrong and got fixed)
    // is treated as stale, not as valid forever.
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > CART_TTL_MS || savedAt > Date.now() + 60_000) {
      clearCart()
      return empty
    }

    const cart = sanitizeCart(parsed.cart)
    return { cart, summoned: parsed.summoned === true && cart.lines.length > 0 }
  } catch {
    return empty
  }
}

export function saveCart(cart: Cart, summoned: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (cart.lines.length === 0 && cart.diners.length === 0) {
      // Don't leave an empty husk behind that would keep resurrecting a
      // "summoned" flag for a cart with nothing in it.
      window.localStorage.removeItem(CART_STORAGE_KEY)
      return
    }
    const payload: StoredCart = { savedAt: Date.now(), cart, summoned }
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded, private mode, storage disabled by policy. The cart still
    // works for this page view; it just won't survive a reload. Failing loudly
    // here would break the menu over a convenience.
  }
}

export function clearCart(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(CART_STORAGE_KEY)
  } catch {
    /* see saveCart */
  }
}

// ── The one-time tutorial flag ────────────────────────────────────────
// Same defensive posture as everything else in this file: localStorage is the
// DEVICE's memory, not ours, and every access is wrapped because a private
// tab, a full quota or a browser with storage disabled all throw rather than
// return null. Failing to read the flag means the tutorial shows again, which
// is a mildly annoying outcome; failing loudly would break the menu, which is
// not. So both helpers swallow.

/** Has this device already been walked through the cart? */
export function tutorialSeen(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(CART_TUTORIAL_KEY) === '1'
  } catch {
    // Cannot tell — assume SEEN. A visitor whose browser refuses storage
    // would otherwise be shown the same modal on every single add, which is
    // far worse than never seeing it at all.
    return true
  }
}

export function markTutorialSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CART_TUTORIAL_KEY, '1')
  } catch {
    /* Nothing to do and nothing worth saying. */
  }
}
