'use client'

// A tiny tap of physical feedback, for controls where the finger is doing the
// deciding — the clock wheels, the staffing steppers, adding or removing a
// person from a shift.
//
// TWO BACKENDS, BECAUSE THERE IS NO ONE API.
//   Android / Chrome  `navigator.vibrate()`. Real, spec'd, works.
//   iOS Safari        Has no Vibration API at all and never has. What it DOES
//                     have, since 17.4, is a haptic tap when the user flips a
//                     `<input type="checkbox" switch>`. Clicking a hidden one
//                     from script produces that same tap. It is a trick, and
//                     it is the only thing that works on the phone this app is
//                     actually used on.
// Anything else — desktop, an older iPhone, a browser with vibration disabled —
// silently gets nothing. That is the correct outcome: haptics are seasoning,
// never the signal, so every caller must still read correctly without them.
//
// The switch element is created lazily on first use, not at import: building
// DOM at module scope runs during SSR bundling and on pages that never tap
// anything.

type Pattern = 'tick' | 'select' | 'impact'

/** Milliseconds, for the backend that measures in milliseconds. Short on
 *  purpose — a wheel that buzzes for 40ms per digit feels broken, not tactile. */
const MS: Record<Pattern, number> = {
  tick: 6,    // one value crossed on a wheel, one step on a stepper
  select: 12, // a choice committed — someone assigned, a pill picked
  impact: 22, // something removed or destroyed
}

/** iOS's own haptic engine collapses taps that arrive too close together, and
 *  Android's motor just stutters. Rate-limited here so a fast flick through a
 *  wheel reads as a rattle rather than one long smear. */
const MIN_GAP_MS = 24
let lastAt = 0

let iosSwitch: HTMLLabelElement | null = null
/** null = not yet decided. Set once the first attempt tells us what works. */
let vibrateWorks: boolean | null = null

function iosTap(): void {
  if (typeof document === 'undefined') return
  if (!iosSwitch) {
    // Deliberately NOT display:none — an unrendered control is not flipped,
    // and iOS gives no feedback for a state change it never painted. Kept
    // invisible, unhittable and out of the accessibility tree instead.
    const label = document.createElement('label')
    label.setAttribute('aria-hidden', 'true')
    label.style.cssText =
      'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1'

    const input = document.createElement('input')
    input.type = 'checkbox'
    // Not a React prop and not in the HTML spec's IDL — set as an attribute,
    // which is the form Safari looks for.
    input.setAttribute('switch', '')
    input.tabIndex = -1
    label.appendChild(input)

    document.body.appendChild(label)
    iosSwitch = label
  }
  iosSwitch.click()
}

/**
 * Fire one haptic tap. Safe to call from anywhere, on any platform, at any
 * rate — it is throttled, it never throws, and it does nothing at all where
 * the hardware or the browser cannot oblige.
 */
export function haptic(pattern: Pattern = 'tick'): void {
  if (typeof window === 'undefined') return

  const now = Date.now()
  if (now - lastAt < MIN_GAP_MS) return
  lastAt = now

  try {
    if (vibrateWorks !== false && typeof navigator.vibrate === 'function') {
      // Returns false when the browser has the API but refuses the request
      // (no motor, a page that has never been interacted with, vibration
      // disabled in settings). Remembered, so we stop asking and fall through
      // to the iOS path forever after.
      const ok = navigator.vibrate(MS[pattern])
      vibrateWorks = ok
      if (ok) return
    }
    iosTap()
  } catch {
    /* A haptic that throws must never take a tap handler down with it. */
  }
}
