// The intro's timeline and rules — pure, no React, no DOM, safe on server and
// client. Exercised by scripts/check-intro.mjs against THIS file.
//
// ONE SOURCE for every number. The component feeds `introCssVars()` into the
// overlay's inline style and intro.css reads them with var(), so the stylesheet
// carries no timing of its own: to make the intro faster or slower, edit this
// file and nothing else. The harness fails if the stylesheet reads a variable
// this file doesn't provide, or the other way round.
//
// TWO VERSIONS, because it runs on every full load of the portal:
//   • FIRST — a visitor who has never seen it on this device. A real welcome:
//     the coin turns toward them as it lights, sparkles catch around it, the
//     words arrive slowly, the finished screen is held. About five seconds.
//   • REPEAT — every load after that. The short one: about three seconds, the
//     length the owner approved on 2026-10-03 and asked to keep for repeat
//     loads. The harness pins these numbers so a later tweak to the welcome
//     can never quietly lengthen the one people see every day.
// Either can be skipped with a tap, a key or a scroll.
//
// WHERE IT PLAYS
// Only on a full document load of the portal. `/menu` is deliberately not on
// the list: that is where a table's QR code or NFC chip lands, and someone who
// scanned to read the menu should not have to sit through a brand moment first.
// The owner/staff areas are not on it either — an owner refreshes the dashboard
// dozens of times a shift. Adding a page is one entry here.

export const INTRO_PATHS: readonly string[] = ['/']

export function isIntroPath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && INTRO_PATHS.includes(pathname)
}

// ---- the owner's switch --------------------------------------------------

/** The value stored for the owner's on/off switch (`intro_enabled` in
 *  app_settings, key + default in lib/settings/keys.ts). The row is owner-
 *  written but hand-editable in the SQL editor, so — like the language switch —
 *  ONLY an explicit `false` turns the intro off. A missing row, `null`, the
 *  string "false", `0`, anything odd: the intro stays ON. The intro is a
 *  decoration the owner asked for, so a settings blip must never silently
 *  remove it. */
export function normalizeIntroEnabled(raw: unknown): boolean {
  return raw !== false
}

/** Resolves to `fallback` if `work` has not settled within `ms`, and never
 *  rejects. The intro is a layer on top of EVERY page (the layout renders it),
 *  so reading its switch must never be the reason a page is slow: a Supabase
 *  that hangs instead of failing would otherwise stall every route's render
 *  until the platform's own timeout. The timer is cleared the moment the work
 *  settles, so nothing is left running behind a fast read. */
export function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    work.then(
      (v) => { clearTimeout(timer); resolve(v) },
      () => { clearTimeout(timer); resolve(fallback) },
    )
  })
}

/** How long the page waits for the switch before showing the intro anyway. */
export const INTRO_GATE_TIMEOUT_MS = 1500

// ---- which version a visitor sees ---------------------------------------

export type IntroVariant = 'first' | 'repeat'

/** localStorage key remembering that this device has been shown the welcome.
 *  Per device, not per language, and it never expires: a customer who comes
 *  back in six months has still seen it. */
export const INTRO_SEEN_KEY = 'ayeka.intro.seen.v1'

export interface VariantInput {
  /** `?intro=` from the URL — the owner's preview links. */
  forced: string | null | undefined
  /** This device already has the seen marker. */
  seen: boolean
  /** The marker could actually be stored (private windows and blocked storage
   *  throw). */
  canRemember: boolean
}

/** Which version to play, and whether this load is only a preview.
 *
 *  A device that cannot remember gets the SHORT version, every time: if the
 *  welcome could not be marked as seen it would play on every load, which is
 *  exactly the tiring thing this whole design exists to avoid. A preview
 *  (`?intro=first` / `?intro=repeat`) plays whichever was asked for and — the
 *  caller's job — does not touch the marker, so previewing never uses up a real
 *  first visit. */
export function pickVariant(i: VariantInput): { variant: IntroVariant; preview: boolean } {
  if (i.forced === 'first' || i.forced === 'repeat') return { variant: i.forced, preview: true }
  if (!i.canRemember || i.seen) return { variant: 'repeat', preview: false }
  return { variant: 'first', preview: false }
}

// ---- the timelines -------------------------------------------------------

/** The longest the whole show may take, from the moment the coin is lit to the
 *  moment the overlay is gone. It runs on EVERY refresh, so for the repeat
 *  version this number is the difference between "a nice touch" and "I stopped
 *  refreshing the page"; the welcome gets more room because it is shown once.
 *  The harness holds every language to it. */
export const INTRO_BUDGET_MS: Record<IntroVariant, number> = { repeat: 3000, first: 5500 }

interface Line { atMs: number; stepMs: number; wordMs: number }

export interface IntroTiming {
  /** The coin and the halo behind it igniting. */
  litMs: number
  /** The thin neon rule between the coin and the words. */
  rule: { atMs: number; ms: number }
  /** A glint of light crossing the coin, once. */
  glint: { atMs: number; ms: number }
  /** The headline, word by word. */
  line1: Line
  /** The sub-line. Starts before the headline has finished in the short
   *  version: the eye is already moving down. */
  line2: Line
  /** The "tap to skip" hint — late and quiet, so a first-time visitor reads
   *  the brand first and a regular reads the way out. */
  hint: { atMs: number; ms: number }
  /** How long the finished screen is held before leaving. */
  holdMs: number
  exit: {
    /** The overlay's own fade starts a beat after the content begins to leave,
     *  so the coin and words lead and the dark follows. */
    delayMs: number
    ms: number
    /** The coin + words travelling out (inside the fade above). */
    stageMs: number
    /** After this long into the exit the overlay stops catching taps, so a
     *  button that is already visible can be pressed. */
    passAtMs: number
  }
  /** FIRST ONLY — how long the coin takes to turn from a three-quarter view to
   *  face-on. (0 in the repeat version, which never reads it.) */
  turnMs: number
  /** FIRST ONLY — how long each sparkle takes to catch and fade. */
  sparkMs: number
}

/** The short version: about three seconds. THESE NUMBERS ARE PINNED by the
 *  harness — they are what the owner approved for repeat loads. */
const REPEAT: IntroTiming = {
  litMs: 900,
  rule: { atMs: 200, ms: 460 },
  glint: { atMs: 420, ms: 950 },
  line1: { atMs: 150, stepMs: 55, wordMs: 560 },
  line2: { atMs: 640, stepMs: 32, wordMs: 520 },
  hint: { atMs: 1100, ms: 600 },
  holdMs: 650,
  exit: { delayMs: 100, ms: 560, stageMs: 520, passAtMs: 280 },
  turnMs: 0,
  sparkMs: 0,
}

/** The welcome: about five seconds, once per device. The same two lines, given
 *  room — the coin alone for a beat before any word, a slower headline, a held
 *  finish — plus the two things only this version has: the turn and the
 *  sparkles. The skip hint comes earlier here: a first-time visitor is the one
 *  who most needs to know the way out. */
const FIRST: IntroTiming = {
  litMs: 1500,
  rule: { atMs: 900, ms: 600 },
  glint: { atMs: 700, ms: 1300 },
  line1: { atMs: 1000, stepMs: 95, wordMs: 760 },
  line2: { atMs: 2000, stepMs: 52, wordMs: 660 },
  hint: { atMs: 1500, ms: 700 },
  holdMs: 1200,
  exit: { delayMs: 120, ms: 700, stageMs: 640, passAtMs: 340 },
  turnMs: 1800,
  sparkMs: 1100,
}

export const INTRO_TIMINGS: Record<IntroVariant, IntroTiming> = { first: FIRST, repeat: REPEAT }

/** A tap, key press or scroll — the way out for anyone who has seen it. Not
 *  per-version: leaving early is leaving early. */
export const INTRO_SKIP_MS = 260

/** Before showing anything the component waits for `<html lang>` and
 *  `<html class>` to stop changing: the language switcher and the
 *  accessibility widget each write them in their own post-hydration effect.
 *  `quietMs` of no change settles it; `maxMs` caps the wait. Happens BEFORE the
 *  version is chosen, so it cannot belong to one. */
export const INTRO_SETTLE = { quietMs: 90, maxMs: 450 } as const

/** If the page's script has not taken over this long after first paint, CSS
 *  hides the overlay on its own. The page underneath is fully server-rendered
 *  and works without script, so a hung bundle must never leave a visitor
 *  looking at a logo. Set before any script runs, so it is shared. */
export const INTRO_FAILSAFE_MS = 4000

/** The sparkles of the welcome. Each sits at (x, y) in COIN-LENGTHS from the
 *  coin's centre (so the group scales with the coin on every screen), is `k`
 *  coin-lengths across, and catches `atMs` after the coin is lit. Positions
 *  hug the rim and the halo, never the words below, and never reach a screen
 *  edge even on the narrowest phone (the harness checks the bounds). */
export interface IntroSparkle { x: number; y: number; k: number; atMs: number }

export const INTRO_SPARKLES: readonly IntroSparkle[] = [
  { x: -0.58, y: -0.46, k: 0.095, atMs: 250 },
  { x: 0.66, y: 0.30, k: 0.085, atMs: 400 },
  { x: 0.60, y: -0.34, k: 0.070, atMs: 620 },
  // The two lowest flank the neon rule symmetrically instead of sitting over
  // it — nothing may twinkle on top of the headline's column.
  { x: 0.42, y: 0.58, k: 0.060, atMs: 800 },
  { x: -0.70, y: 0.12, k: 0.060, atMs: 980 },
  { x: -0.36, y: 0.60, k: 0.065, atMs: 1250 },
  { x: 0.30, y: -0.66, k: 0.050, atMs: 1500 },
]

/** The portal's own staggered entrance has finished long before the intro
 *  does (it runs under the overlay), so as the overlay lifts the intro plays
 *  that entrance once more, on the elements that are on screen. Same fade-and-
 *  rise as `rise-in` in globals.css. `selector` is the codebase's existing way
 *  of naming those elements (see `.page-enter--pushed` in globals.css). */
export const INTRO_REPLAY = {
  selector: '#main [style*="rise-in"]',
  atMs: 140,
  stepMs: 70,
  durationMs: 560,
  risepx: 16,
} as const

export interface IntroPlan {
  /** When the last word has finished arriving. */
  textEndMs: number
  /** When the exit starts. */
  exitAtMs: number
  /** When the overlay can be removed. */
  doneAtMs: number
}

/** The timeline for a given pair of line lengths (in words). A translation
 *  with more words simply runs a little longer — the exit follows the text,
 *  it is not a fixed time that a long sentence could be cut off by. */
export function planTimeline(words1: number, words2: number, variant: IntroVariant = 'repeat'): IntroPlan {
  const t = INTRO_TIMINGS[variant]
  const end = (line: Line, n: number) => line.atMs + Math.max(0, n - 1) * line.stepMs + line.wordMs
  const textEndMs = Math.max(end(t.line1, words1), end(t.line2, words2))
  const exitAtMs = textEndMs + t.holdMs
  const doneAtMs = exitAtMs + t.exit.delayMs + t.exit.ms + 40
  return { textEndMs, exitAtMs, doneAtMs }
}

/** The last moment any sparkle is still twinkling, for the harness to hold
 *  against the exit. */
export function sparklesEndMs(variant: IntroVariant = 'first'): number {
  const t = INTRO_TIMINGS[variant]
  return INTRO_SPARKLES.reduce((m, s) => Math.max(m, s.atMs + t.sparkMs), 0)
}

/** Every custom property intro.css reads, so the numbers above are the only
 *  numbers. Names are `--intro-*`; the per-word index (`--i`) and each
 *  sparkle's own position are set on those elements themselves. Both versions
 *  provide the SAME keys (the harness checks), so switching version at the
 *  moment the show starts only ever changes values. */
export function introCssVars(variant: IntroVariant = 'repeat'): Record<string, string> {
  const t = INTRO_TIMINGS[variant]
  const ms = (n: number) => `${n}ms`
  return {
    '--intro-lit': ms(t.litMs),
    '--intro-turn': ms(t.turnMs),
    '--intro-spark': ms(t.sparkMs),
    '--intro-rule-at': ms(t.rule.atMs),
    '--intro-rule': ms(t.rule.ms),
    '--intro-glint-at': ms(t.glint.atMs),
    '--intro-glint': ms(t.glint.ms),
    '--intro-l1-at': ms(t.line1.atMs),
    '--intro-l1-step': ms(t.line1.stepMs),
    '--intro-w1': ms(t.line1.wordMs),
    '--intro-l2-at': ms(t.line2.atMs),
    '--intro-l2-step': ms(t.line2.stepMs),
    '--intro-w2': ms(t.line2.wordMs),
    '--intro-hint-at': ms(t.hint.atMs),
    '--intro-hint': ms(t.hint.ms),
    '--intro-exit-delay': ms(t.exit.delayMs),
    '--intro-exit': ms(t.exit.ms),
    '--intro-stage-exit': ms(t.exit.stageMs),
    '--intro-skip': ms(INTRO_SKIP_MS),
    '--intro-failsafe': ms(INTRO_FAILSAFE_MS),
  }
}
