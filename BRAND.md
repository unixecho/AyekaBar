# BRAND.md

Visual direction and asset-generation plan for **אייכה בר**.

> **No real artwork exists yet.** Until the owner supplies a logo and photos,
> everything is generated from scratch and treated as a swappable placeholder.
> Keep generated assets behind stable paths so real art can drop in later with
> no code changes.

## Direction: dark & moody / neon

A nightlife feel. Deep, near-black backgrounds; warm neon accents that glow;
smooth, low, confident motion. Upscale enough to feel like a real bar, not a
template. The portal should feel like the bar's sign lighting up when you walk
up to it.

Mood words: **night, glow, warm, intimate, electric, smooth.**

## Color palette

Defined as CSS custom properties (put these in `:root` in `styles.css`).

```css
:root {
  /* Base — deep night */
  --bg:            #0a0a0f;   /* near-black, very slight blue */
  --bg-elev:       #141420;   /* elevated surfaces / cards */
  --bg-elev-2:     #1d1d2b;   /* hover / second elevation */

  /* Neon accents — warm primary, cool secondary */
  --neon:          #ff5e3a;   /* primary: warm ember/amber-red glow */
  --neon-soft:     #ff8a5c;   /* lighter primary for gradients */
  --neon-2:        #38e1ff;   /* secondary: cool electric cyan */
  --neon-2-soft:   #7defff;

  /* Text */
  --text:          #f5f3ef;   /* warm off-white */
  --text-dim:      #a8a5b0;   /* secondary text */
  --text-faint:    #6a6776;   /* captions / disabled */

  /* Lines & glow */
  --line:          rgba(245,243,239,0.08);
  --glow:          0 0 24px rgba(255,94,58,0.45);
  --glow-2:        0 0 24px rgba(56,225,255,0.40);
}
```

Usage rules:

- Background stays dark everywhere. Don't introduce light-mode surfaces.
- **One** neon accent leads per screen (warm `--neon` is primary). Cyan
  `--neon-2` is a sparing secondary — use it for a single contrasting detail,
  not everywhere, or the "neon" reads as "rainbow."
- Glow comes from `box-shadow`/`text-shadow` + subtle gradients, never from
  heavy borders.
- Maintain AA contrast for body text (`--text` on `--bg`/`--bg-elev`). Neon is
  for accents and large display type, not paragraph text.

## Typography

- **Rubik**, self-hosted as variable woff2 subsets (Hebrew, Latin, Arabic,
  Latin-ext) in `assets/fonts/`. One face for all three languages so type is
  unified. Variable weight axis 300–900.
- `@font-face` blocks with per-subset `unicode-range` at the top of
  `styles.css`; preload the Hebrew + Latin subsets in each HTML `<head>`.
- Display/brand: heavy weight (700–900), generous letter-spacing in Latin,
  default spacing in Hebrew/Arabic.
- Body: 400–500. Don't faux-bold; use real weights.
- No second typeface, no Google Fonts CDN at runtime.

## Motion

Smooth and aesthetic is an explicit project goal.

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (gentle overshoot-free settle).
- Portal entrance: brand "lights up" — logo/title fades up with a glow that
  blooms then settles; action buttons stagger in beneath it.
- Buttons: soft glow intensifies on hover/active/focus; press gives a small
  scale.
- Prefer `transform` + `opacity`. Avoid animating layout properties.
- Always respect `@media (prefers-reduced-motion: reduce)` — drop to simple
  fades / no motion.
- Optional ambient: a very subtle slow-drifting gradient or grain behind the
  portal to suggest a lit room. Keep it cheap (CSS, no heavy JS loops) and
  reduced-motion-safe.

## Logo & asset generation plan

Until real artwork arrives, generate and commit these as placeholders:

| Asset                         | Notes                                                          |
| ----------------------------- | -------------------------------------------------------------- |
| `assets/logo.svg`             | Wordmark "אייכה בר" with a neon-glow treatment. SVG so it scales for QR-stand print and screen. |
| `assets/favicon.ico` / `.svg` | Simplified glyph mark (e.g. a single neon letter/icon).        |
| `assets/og-image.png`         | 1200×630 social/share card, dark + neon.                       |
| `assets/bg-portal.*`          | Optional dark ambient texture/gradient for the portal.         |
| `assets/icons/`               | Action icons (navigation pin, menu, Instagram, review/star) in a consistent neon line style. SVG. |
| `assets/menu-item-placeholder.svg` | Neutral dark placeholder for menu items with no photo yet. |

Generation guidelines:

- **SVG-first** for logo/icons (crisp on print stands and high-DPI screens).
- Keep a consistent stroke weight and corner radius across icons.
- Name and path assets so the real versions can overwrite them 1:1.
- When the owner provides real art/photos, swap files in place and delete the
  generator notes — no markup changes should be needed.

## Owner-supplied artwork — open questions

Flag these to the owner (track in `HANDOFF.md`):

- Final **logo / wordmark** and any brand color they already use.
- **Photos** of the space and menu items (replace placeholders).
- Confirm the **Arabic spelling** of the bar name (transliteration used in docs
  is provisional).
- Any existing **brand fonts** they're attached to (default stays Rubik).
