'use client'

// A "ding" and a buzz for a staff member who is LOOKING at the screen when something arrives (the push
// notification is for when they are not — its sound and vibration belong to the operating system).
//
// ⚠️ TWIN: ayeka-staff/src/ding.ts is this file, kept identical on purpose (two repos, one behaviour — the same
// discipline as lib/waiter/grid.ts). Change one, change the other.
//
// Two honest limits, so nobody is surprised by them later:
//   • A browser will not play audio until the person has touched the page once. `armAudioUnlock()` listens for
//     that first touch and wakes the audio context; until then `playDing()` is a silent no-op, never an error. A
//     waiter has always tapped something by the time an order arrives, but a freshly opened, untouched page will
//     be silent — the notification's own sound covers that case.
//   • iOS Safari does not expose vibration at all. `buzz()` no-ops there; the sound and the banner are the signal.
//
// Nothing here is stored anywhere (no localStorage key — a key is a privacy disclosure in these apps).

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    return ctx
  } catch {
    return null
  }
}

/** Wake the audio context on the first touch or key press anywhere on the page. Safe to call more than once. */
export function armAudioUnlock(): () => void {
  const wake = () => {
    try { const c = audio(); if (c && c.state === 'suspended') void c.resume() } catch { /* unsupported */ }
  }
  const events = ['pointerdown', 'keydown', 'touchstart'] as const
  for (const e of events) window.addEventListener(e, wake, { passive: true })
  return () => { for (const e of events) window.removeEventListener(e, wake) }
}

/** Two bell-like tones, a fifth apart, each a short attack and a long decay. Quiet enough for a bar, clear enough
 *  to carry across one. A no-op if audio is unavailable or has not been unlocked. */
export function playDing(): void {
  try {
    const c = audio()
    if (!c) return
    if (c.state === 'suspended') void c.resume()
    if (c.state !== 'running') return
    const start = c.currentTime
    for (const [freq, offset] of [[988, 0], [1319, 0.16]] as const) {
      const osc = c.createOscillator()
      const gain = c.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const t0 = start + offset
      gain.gain.setValueAtTime(0.0001, t0)
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1)
      osc.connect(gain).connect(c.destination)
      osc.start(t0)
      osc.stop(t0 + 1.2)
    }
  } catch { /* a failed ding must never break the screen */ }
}

/** The same pattern the push notification asks the phone for (lib/push/orders-rules.ts ORDER_VIBRATION). */
export function buzz(pattern: number[] = [320, 110, 320, 110, 520]): void {
  try { navigator.vibrate?.(pattern) } catch { /* unsupported */ }
}
