// The in-house accessibility widget's domain types. Pure — no DOM, no React.
// Design record: PLAN_ACCESSIBILITY.md §3. Built "Ayeka-only first" (§3.9,
// 2026-09-03), so — unlike src/lib/cart and src/lib/shifts, which this
// module otherwise copies the discipline of (pure logic here, DOM/React in
// components/a11y/) — it is NOT held to the stricter no-outside-imports
// portability rule §3.2 describes for a later, actually-portable build.
//
// GOVERNING PRINCIPLE, repeated from the plan because it constrains every
// file in this directory: this widget is a user-PREFERENCE convenience
// layer, never a compliance mechanism. Nothing here may stand in for a
// code-level fix — see PLAN_ACCESSIBILITY.md §3.5's Exclude table for what
// was deliberately left out and why.

/** 0 = 100% (default) .. 4 = 150%. Applied to <html>'s root font-size, which
 *  cascades correctly because this codebase's own type scale is rem-based
 *  throughout (`fontSize: '0.9rem'` etc. — verified by reading the
 *  components before choosing this mechanism). */
export type FontScaleStep = 0 | 1 | 2 | 3 | 4

/** 0 = normal .. 3 = wide. Drives letter-spacing, word-spacing and
 *  line-height together — see apply.ts for the exact values and why
 *  line-height is applied WITHOUT !important (a deliberate, documented
 *  trade-off, not an oversight). */
export type SpacingStep = 0 | 1 | 2 | 3

export type ContrastMode = 'default' | 'high' | 'grayscale' | 'invert'

export interface A11yPrefs {
  fontScale: FontScaleStep
  spacing: SpacingStep
  contrast: ContrastMode
  pauseAnimations: boolean
  readingGuide: boolean
  highlightLinks: boolean
  highlightHeadings: boolean
  bigCursor: boolean
}

export const DEFAULT_A11Y_PREFS: A11yPrefs = {
  fontScale: 0,
  spacing: 0,
  contrast: 'default',
  pauseAnimations: false,
  readingGuide: false,
  highlightLinks: false,
  highlightHeadings: false,
  bigCursor: false,
}

export const FONT_SCALE_STEPS: FontScaleStep[] = [0, 1, 2, 3, 4]
export const SPACING_STEPS: SpacingStep[] = [0, 1, 2, 3]
export const CONTRAST_MODES: ContrastMode[] = ['default', 'high', 'grayscale', 'invert']

/** Physical corner only, never logical start/end — the same house rule
 *  CartFab.tsx states explicitly: fixed chrome stays in the same physical
 *  corner regardless of text direction, so a value here must not flip
 *  meaning under RTL. */
export type A11yCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface A11yWidgetConfig {
  /** Physical corner for the launcher button. Default 'top-right' — the one
   *  corner nothing else on this site currently occupies (language switch:
   *  top-left, cart: bottom-left, Negishot: bottom-right). */
  corner?: A11yCorner
  /** CSS color for the launcher/panel accent. Falls back to the site's own
   *  --neon token via a plain CSS var reference, not a hardcoded hex. */
  accentColor?: string
  /** Injected, never re-implemented — see components/a11y/A11yProvider.tsx's
   *  header for why (the haptics.ts focus-neutrality lesson). */
  onHaptic?: (pattern: 'tick' | 'select') => void
}

export const DEFAULT_A11Y_CONFIG: Required<Pick<A11yWidgetConfig, 'corner'>> = {
  corner: 'top-right',
}
