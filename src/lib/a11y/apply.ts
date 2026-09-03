import type { A11yPrefs } from './types'

/** What A11yProvider actually writes to the DOM for a given set of prefs.
 *  PURE — no DOM access here, so it is unit-testable by check-a11y.mjs the
 *  same way lib/cart/store.ts's reducer is. The provider diffs this against
 *  the live <html> element and #a11y-scope wrapper and writes only what
 *  changed. */
export interface AppliedA11yState {
  /** CSS custom properties written to <html>. */
  htmlVars: Record<string, string>
  /** Classes written to <html> — properties that do NOT create a CSS
   *  containing block (animation-duration, cursor, outline, text-decoration)
   *  so they are safe directly on the root and apply to portalled content
   *  too (see #a11y-scope below for the ones that are NOT safe there). */
  htmlClasses: string[]
  /** `filter` value for #a11y-scope ONLY, never <html>/<body>.
   *
   *  WHY: this codebase has already documented twice (CartFab.tsx,
   *  ModalPortal.tsx) that `transform` on an ancestor silently makes it a
   *  CSS containing block for every descendant `position: fixed` element —
   *  which is why the cart FAB and every sheet are portalled to
   *  document.body. `filter` triggers the IDENTICAL behaviour, for the
   *  identical reason (same containing-block trigger list). Applying
   *  `filter: grayscale(1)` to <html> would silently break the cart FAB,
   *  every SheetShell-based sheet and this widget's own launcher — turning
   *  on grayscale would visually relocate every fixed control on the site.
   *  Scoping to #a11y-scope (which wraps {children} in layout.tsx, OUTSIDE
   *  this widget's own portalled UI) avoids that entirely: a visitor in
   *  grayscale mode still sees the a11y panel and this site's other fixed
   *  chrome in full color, because none of it is a descendant of the
   *  filtered element. */
  scopeFilter: string
}

const FONT_SCALE_PCT = ['100%', '112.5%', '125%', '137.5%', '150%']
const LETTER_SPACING = ['normal', '0.04em', '0.08em', '0.12em']
const WORD_SPACING = ['normal', '0.12em', '0.2em', '0.3em']
/** Deliberately WITHOUT !important at the point of use (a11y.css) — unlike
 *  every other effect here, forcing line-height everywhere would collide
 *  with the many components in this codebase that set a precise inline
 *  `lineHeight` for tight icon+text alignment (see FeedbackSheet.tsx,
 *  Portal.tsx, etc.). Applied only where nothing more specific already
 *  claimed it, which is an honest partial fix, not a silent no-op — see
 *  a11y.css's own comment at the point of use. */
const LINE_HEIGHT = ['normal', '1.6', '1.8', '2.15']

export function computeAppliedState(prefs: A11yPrefs): AppliedA11yState {
  const htmlVars: Record<string, string> = {
    '--a11y-font-scale': FONT_SCALE_PCT[prefs.fontScale],
    '--a11y-letter-spacing': LETTER_SPACING[prefs.spacing],
    '--a11y-word-spacing': WORD_SPACING[prefs.spacing],
    '--a11y-line-height': LINE_HEIGHT[prefs.spacing],
  }

  const htmlClasses: string[] = []
  if (prefs.pauseAnimations) htmlClasses.push('a11y-motion-off')
  if (prefs.highlightLinks) htmlClasses.push('a11y-highlight-links')
  if (prefs.highlightHeadings) htmlClasses.push('a11y-highlight-headings')
  if (prefs.bigCursor) htmlClasses.push('a11y-big-cursor')

  const scopeFilter =
    prefs.contrast === 'high' ? 'contrast(1.35) saturate(1.15)'
    : prefs.contrast === 'grayscale' ? 'grayscale(1)'
    : prefs.contrast === 'invert' ? 'invert(1) hue-rotate(180deg)'
    : 'none'

  return { htmlVars, htmlClasses, scopeFilter }
}

/** Every class computeAppliedState can ever produce — so the provider can
 *  remove a class that is no longer wanted without tracking previous state
 *  itself (`classList.remove(...ALL_A11Y_CLASSES); classList.add(...next)`).
 *  Kept here, next to the one function that emits them, so the two cannot
 *  drift apart. */
export const ALL_A11Y_HTML_CLASSES = [
  'a11y-motion-off', 'a11y-highlight-links', 'a11y-highlight-headings', 'a11y-big-cursor',
]
