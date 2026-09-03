import {
  DEFAULT_A11Y_PREFS, FONT_SCALE_STEPS, SPACING_STEPS, CONTRAST_MODES,
  type A11yPrefs, type FontScaleStep, type SpacingStep, type ContrastMode,
} from './types'

/** Versioned, unlike the cart's `.v1` key which the cart is free to abandon
 *  on a schema change — this one is meant to survive one, see the header
 *  comment. No TTL: DELIBERATE, unlike lib/cart/storage.ts's 8h expiry. A
 *  font-scale or high-contrast choice is closer to an OS accessibility
 *  setting than an abandoned shopping cart and should not silently reset —
 *  see PLAN_ACCESSIBILITY.md §3.6. */
const KEY = 'ayeka.a11y.prefs.v1'

/** Never throws, never trusts the input — same rigor as
 *  lib/cart/storage.ts's sanitizeCart() and lib/feedback/validate.ts:
 *  every field is type- and range-checked independently, and an
 *  unrecognised value falls back to the default for THAT field rather than
 *  discarding the whole object (so one corrupted key doesn't cost every
 *  other preference the visitor set). */
export function sanitizeA11yPrefs(raw: unknown): A11yPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_A11Y_PREFS }
  const r = raw as Record<string, unknown>
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    fontScale: FONT_SCALE_STEPS.includes(r.fontScale as FontScaleStep)
      ? (r.fontScale as FontScaleStep) : DEFAULT_A11Y_PREFS.fontScale,
    spacing: SPACING_STEPS.includes(r.spacing as SpacingStep)
      ? (r.spacing as SpacingStep) : DEFAULT_A11Y_PREFS.spacing,
    contrast: CONTRAST_MODES.includes(r.contrast as ContrastMode)
      ? (r.contrast as ContrastMode) : DEFAULT_A11Y_PREFS.contrast,
    pauseAnimations: bool(r.pauseAnimations, DEFAULT_A11Y_PREFS.pauseAnimations),
    readingGuide: bool(r.readingGuide, DEFAULT_A11Y_PREFS.readingGuide),
    highlightLinks: bool(r.highlightLinks, DEFAULT_A11Y_PREFS.highlightLinks),
    highlightHeadings: bool(r.highlightHeadings, DEFAULT_A11Y_PREFS.highlightHeadings),
    bigCursor: bool(r.bigCursor, DEFAULT_A11Y_PREFS.bigCursor),
  }
}

export function loadA11yPrefs(): A11yPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_A11Y_PREFS }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_A11Y_PREFS }
    return sanitizeA11yPrefs(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_A11Y_PREFS }
  }
}

export function saveA11yPrefs(prefs: A11yPrefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Private browsing / storage full: the preference just doesn't survive
    // a reload. Not fatal — the widget still works for the rest of the visit.
  }
}
