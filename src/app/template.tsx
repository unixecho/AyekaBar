'use client'

import { useState } from 'react'

// Every route change animates in, across the whole app.
//
// This is a `template`, not a `layout`, and that is the entire trick: Next
// re-creates a template on every navigation (a layout persists), so the
// wrapper below remounts each time and its CSS entrance animation replays.
// One file, no library, no per-page wiring — /owner/dashboard → /owner/editor
// glides, and so does anything added later.
//
// NOTE for anyone tempted to make it fancier: an animation that LEAVES a
// transform on this element would turn it into the containing block for every
// `position: fixed` descendant — every bottom sheet in the owner panel would
// anchor to the page instead of the viewport. The keyframes below therefore
// end at `transform: none`.
//
// ---- why this reads `data-vt` into local state instead of letting CSS key
// off it live ----
//
// A page arriving via the click-driven push (lib/nav/viewTransition.ts) needs
// its OWN entrance motion — this wrapper's fallback slide, and every button's
// individual `.rise` stagger — suppressed for that one arrival, so it doesn't
// play a second, competing animation on top of the push. That suppression
// used to be a live CSS rule keyed off `html[data-vt="running"]`, cleared by a
// timer once the push settled.
//
// That was the bug the owner then reported as "finishes, then does a little
// refresh and starts again": per the CSS Animations spec, toggling
// `animation-name` between `none` and a real value starts a BRAND NEW
// animation instance. The moment the timer cleared `data-vt` and the
// `animation: none !important` override lifted, every already-settled button
// didn't resume anything — it replayed its entire entrance from frame zero,
// on a page that had already finished arriving.
//
// The fix is to never toggle the override at all. `pushed` is read ONCE, via
// a lazy useState initializer, the instant this component is constructed —
// which is also the instant `.page-enter`'s children (including every `.rise`
// element) are first created. Being local state, it cannot change for the
// lifetime of THIS mounted instance, no matter what `data-vt` does afterward
// — there is no later toggle for these specific elements to react to, so
// there is nothing left to replay. The next navigation remounts this
// component fresh (new page, new instance, new read), which is exactly the
// one moment a new decision SHOULD be made.
export default function Template({ children }: { children: React.ReactNode }) {
  const [pushed] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.vt === 'running',
  )
  return <div className={pushed ? 'page-enter page-enter--pushed' : 'page-enter'}>{children}</div>
}
