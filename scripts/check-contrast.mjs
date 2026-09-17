#!/usr/bin/env node
// Site-wide contrast regression harness — closes PLAN_ACCESSIBILITY.md's A13
// ("re-run the audit as a script... the contrast pass in particular has
// already caught a real regression once").
//
//   node scripts/check-contrast.mjs
//
// WHAT IT IS ACTUALLY GUARDING
//   Every pair below is a color relationship this project computed BY HAND
//   at least once during a live audit (see PLAN_ACCESSIBILITY.md §1.2/A15
//   and the DinerStrip/CartFab fix this same session) and found either
//   passing or failing WCAG 1.4.11/1.4.3. Re-deriving that by hand every
//   time a token or a palette changes is exactly the kind of check this
//   file exists to make free. It reads the REAL token values out of
//   globals.css and the REAL palette out of src/lib/cart/types.ts — never a
//   hardcoded snapshot of what those values used to be — so a future edit
//   that regresses a ratio fails this script instead of waiting for the
//   next live audit to notice.
//
// WHAT IT DOES NOT COVER
//   Contrast is a per-pixel property of the rendered page, not of a token in
//   isolation — a token used against a *different* background than the ones
//   listed here is not checked. This is the same honest limitation every
//   harness in this repo has: it guards the specific regressions already
//   found, not every regression that could exist. Add a pair here the next
//   time a live audit computes one by hand.

import { readFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)
const globalsCss = readFileSync(new URL('src/app/globals.css', ROOT), 'utf8')
const cartTypes = readFileSync(new URL('src/lib/cart/types.ts', ROOT), 'utf8')

// ── extract tokens from the actual :root block ───────────────────────────

const rootBlock = globalsCss.match(/:root\s*\{([^}]*)\}/s)
if (!rootBlock) throw new Error('no :root block found in globals.css — did the file structure change?')

const tokens = {}
for (const m of rootBlock[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
  tokens[m[1]] = m[2].trim()
}

// ── color parsing / WCAG math ─────────────────────────────────────────────

function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)$/i)
  if (rgba) {
    return { r: +rgba[1], g: +rgba[2], b: +rgba[3], a: rgba[4] !== undefined ? +rgba[4] : 1 }
  }
  throw new Error(`unrecognized color format: "${value}"`)
}

// Flattens a translucent foreground onto an opaque background — the same
// blend a browser does before a screen reader or a sighted user ever sees
// a pixel, and the step the 2026-09-17 DinerStrip audit finding was missed
// by until someone did it by hand.
function blend(fg, bg) {
  if (fg.a >= 1) return fg
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

function relLuminance({ r, g, b }) {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fgValue, bgValue) {
  const bg = parseColor(bgValue)
  const fg = blend(parseColor(fgValue), bg)
  const l1 = relLuminance(fg)
  const l2 = relLuminance(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function resolveToken(name) {
  const v = tokens[name]
  if (!v) throw new Error(`token --${name} not found in globals.css :root — did it get renamed?`)
  return v
}

// ── harness ────────────────────────────────────────────────────────────

let pass = 0
const failures = []

function check(desc, ratio, min) {
  if (ratio >= min) {
    console.log(`  ✓ ${desc} (${ratio.toFixed(2)}:1 ≥ ${min}:1)`)
    pass++
  } else {
    failures.push(`${desc}: ${ratio.toFixed(2)}:1, needs ≥ ${min}:1`)
  }
}

console.log('\nDesign tokens — text and UI-component contrast against their real backgrounds')

// Text tiers (WCAG 1.4.3, normal text needs 4.5:1). --text-faint is the
// dimmest tier and the one that has actually regressed before (see its own
// comment in globals.css) — checked against every elevation it's used on,
// not just --bg, per the 2026-09-04 gap that missed --bg-elev-2.
for (const bg of ['bg', 'bg-elev', 'bg-elev-2']) {
  check(`--text on --${bg}`, contrast(resolveToken('text'), resolveToken(bg)), 4.5)
  check(`--text-dim on --${bg}`, contrast(resolveToken('text-dim'), resolveToken(bg)), 4.5)
  check(`--text-faint on --${bg}`, contrast(resolveToken('text-faint'), resolveToken(bg)), 4.5)
}

// The skip link: solid --neon background, --bg text (WCAG 2.4.1's control,
// found failing 1.4.3 by the 2026-09-04 audit because it's a solid color,
// not one of the gradients the original text-only pass grepped for).
check('--bg text on --neon (skip link)', contrast(resolveToken('bg'), resolveToken('neon')), 4.5)

// Non-text/UI-component contrast (WCAG 1.4.11, needs 3:1). --line-interactive
// is the shared token this project built specifically for an interactive
// control's unselected/idle-state boundary — reused by DinerStrip.tsx's
// diner chips as of this session's fix.
for (const bg of ['bg', 'bg-elev', 'bg-elev-2']) {
  check(`--line-interactive on --${bg}`, contrast(resolveToken('line-interactive'), resolveToken(bg)), 3.0)
}

console.log('\nCart diner/table palette — selected-chip border + dot (full opacity) against --bg')

const tableColourMatch = cartTypes.match(/TABLE_COLOUR\s*=\s*'(#[0-9a-fA-F]{6})'/)
const dinerColoursMatch = cartTypes.match(/DINER_COLOURS\s*=\s*\[([^\]]+)\]/s)
if (!tableColourMatch || !dinerColoursMatch) {
  throw new Error('could not find TABLE_COLOUR / DINER_COLOURS in src/lib/cart/types.ts — did they get renamed or restructured?')
}
const dinerColours = [...dinerColoursMatch[1].matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0])
if (dinerColours.length === 0) throw new Error('DINER_COLOURS parsed to zero colours — regex is out of sync with the source')

const bgValue = resolveToken('bg')
check(`TABLE_COLOUR ${tableColourMatch[1]} on --bg`, contrast(tableColourMatch[1], bgValue), 3.0)
for (const colour of dinerColours) {
  check(`DINER_COLOURS ${colour} on --bg`, contrast(colour, bgValue), 3.0)
}

// ── report ─────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
