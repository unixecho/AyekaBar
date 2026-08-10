// The mechanics behind the iOS push. Kept out of the component so a
// programmatic navigation (sign out, finishing a check-in) can use exactly the
// same path as a tapped link.
//
// Why the View Transitions API rather than animating the pages ourselves: it
// screenshots the outgoing page and animates BOTH pages as pseudo-elements in
// an overlay tree of the browser's own. Nothing in the real DOM is transformed,
// so no element silently becomes the containing block for the fixed-position
// sheets, and — the part CSS alone cannot do — the page you are leaving is
// still on screen, sliding out under the one arriving. That parallax is what
// makes a push read as a push instead of a fade.

type ViewTransition = { finished: Promise<void>; ready: Promise<void> }
type DocWithVT = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => ViewTransition
}

export type NavDirection = 'forward' | 'back'

/** Longest we keep the outgoing screenshot up waiting for the new route. The
 *  API holds painting frozen until the callback settles, so a slow server
 *  component must not be able to freeze the app indefinitely. */
const COMMIT_TIMEOUT_MS = 700

/** Must stay >= the `.page-enter` animation-duration in globals.css (.32s).
 *  Short by even a little and the `.menu-page .item` transition-suppression
 *  below (globals.css) lifts before that animation has actually finished
 *  painting. Everything else `data-vt` used to gate — `.page-enter` itself
 *  and each element's own `.rise` — reads this flag exactly ONCE, at mount,
 *  into template.tsx's local state, so THEIR timing no longer depends on
 *  this constant; only the menu's still-live, still-toggled transition rule
 *  does. See template.tsx for why the split exists. */
const FALLBACK_ANIM_MS = 380

const STACK_KEY = 'ayeka:navStack'

let settle: (() => void) | null = null

/** Called once the new route has actually rendered. */
export function settleNavigation() {
  settle?.()
  settle = null
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

// ---- direction ------------------------------------------------------------
// Browsers don't tell you whether a navigation is "deeper" or "back", and the
// app's own back buttons are ordinary links, not history.back(). So we keep the
// stack ourselves: if the destination is the entry we came from, it's a back.

function readStack(): string[] {
  try { return JSON.parse(sessionStorage.getItem(STACK_KEY) ?? '[]') as string[] } catch { return [] }
}

function writeStack(stack: string[]) {
  try { sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(-25))) } catch { /* private mode */ }
}

export function directionFor(path: string): NavDirection {
  const stack = readStack()
  return stack.length >= 2 && stack[stack.length - 2] === path ? 'back' : 'forward'
}

export function recordNavigation(path: string) {
  const stack = readStack()
  if (stack[stack.length - 2] === path) stack.pop()
  else if (stack[stack.length - 1] !== path) stack.push(path)
  writeStack(stack)
}

// ---- running the thing ----------------------------------------------------

/**
 * Commit a navigation with the push animation around it.
 *
 * `commit` must be the call that actually changes the route; it runs inside the
 * transition so the browser can snapshot before and after.
 */
export function navigateWithTransition(path: string, direction: NavDirection, commit: () => void) {
  const root = document.documentElement
  recordNavigation(path)

  const doc = document as DocWithVT
  const reduced = prefersReducedMotion()

  if (!doc.startViewTransition || reduced) {
    // Unsupported (or unwanted): the CSS entrance in template.tsx still runs,
    // so the page arrives with motion, just without the outgoing half.
    root.dataset.nav = direction
    commit()

    // `data-vt="running"` is what template.tsx reads, once, the instant the
    // arriving page mounts, to decide whether to suppress its OWN entrance
    // motion — this page's .page-enter slide and every button's individual
    // `.rise` stagger. Skip setting it and both play at the same time as
    // whatever else is arriving, which is the "two animations moving the same
    // content" jitter this exists to prevent. It also gates the menu's
    // per-item transition suppression live (see globals.css), which is why
    // this still gets cleared on a timer below. Reduced motion plays neither,
    // so nothing to suppress there.
    if (!reduced) {
      root.dataset.vt = 'running'
      setTimeout(() => { delete root.dataset.vt }, FALLBACK_ANIM_MS)
    }
    return
  }

  root.dataset.nav = direction
  // Suppresses template.tsx's entrance animation: the snapshot is already
  // animating this content, and a second animation inside it looks like a
  // stutter.
  root.dataset.vt = 'running'

  const transition = doc.startViewTransition(() => new Promise<void>((resolve) => {
    settle = resolve
    commit()
    setTimeout(() => { if (settle === resolve) settleNavigation() }, COMMIT_TIMEOUT_MS)
  }))

  const cleanup = () => { delete root.dataset.vt }
  transition.finished.then(cleanup, cleanup)
}
