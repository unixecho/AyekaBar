# CLAUDE.md

Guidance for working in this repository.

## What this is

A **portal website** and **digital menu** for **אייכה בר** (Eicha Bar), a bar in
**Harish (חריש)**, Israel.

Two products live here:

1. **The portal** — the headline product. A short, beautiful landing page that
   acts as the bar's single link hub. It presents the brand and a small set of
   primary actions (navigate to us, digital menu, Instagram, leave a review).
   This is what customers reach first.
2. **The digital menu** — a trilingual, browsable menu reached from the portal
   (and directly from printed **QR codes** and **NFC chips** placed on tables and
   stands). Backed by a small **menu editor** the owner uses to add/edit items
   without touching code.

The site is **trilingual (Hebrew, English, Arabic)** with full **RTL/LTR**
support. **Hebrew is the default and primary language**; the design is built
RTL-first.

> The bar has **no logo or artwork yet.** Everything visual (logo, icons,
> textures, backgrounds, item placeholders) is **generated from scratch** and
> treated as a placeholder until the owner supplies real artwork. See
> `BRAND.md`.

## Tech stack

- **Vanilla HTML/CSS/JS.** No framework, no bundler, no build step. (Same recipe
  as our Sarcafe-Portal and CoffeeTruckQR sites.)
- Menu content is **static data in a JS file** (`menu-data.js`), an array of
  categories → items, each field localized `{ he, en, ar }`. Loaded at runtime,
  no `fetch()` of JSON required (so the menu can open from `file://` too if
  needed).
- The **menu editor** (`editor.html`) is a standalone, dependency-free page that
  reads the live menu data, lets the owner edit it in a guided form, validates,
  and writes back a clean `menu-data.js` (File System Access API in
  Chrome/Edge; download fallback elsewhere). Marked `noindex`.
- Self-hosted **Rubik** variable woff2 subsets (Hebrew/Latin/Arabic) — one
  typeface covers all three languages. No runtime CDN.
- Hosting target: **GitHub Pages** (see `README.md`).

## Planned file map

> Nothing here is built yet — this repo currently holds the **context/instruction
> layer** only (the `*.md` files). This map is the agreed target structure for
> when code is added.

| File / dir            | Responsibility                                                       |
| --------------------- | ------------------------------------------------------------------- |
| `index.html`          | The portal: brand + primary action buttons.                         |
| `menu.html`           | The digital menu (categories, items, language switch).              |
| `editor.html`         | Standalone menu editor (owner tool, `noindex`).                     |
| `styles.css`          | Shared design system: tokens, typography, RTL/LTR, motion.          |
| `portal.js`           | Portal behavior: i18n, link wiring, entrance animation.             |
| `menu.js`             | Menu rendering, category nav, language switch.                      |
| `editor.js`           | Editor logic: load/validate/serialize `menu-data.js`.               |
| `menu-data.js`        | The menu content — the only "content" file the owner edits often.   |
| `i18n.js`             | UI strings keyed by language (`he`/`en`/`ar`).                       |
| `assets/`             | Generated logo, icons, backgrounds, item placeholders.              |
| `assets/fonts/`       | Self-hosted Rubik woff2 subsets.                                     |
| `CLAUDE.md`           | This file.                                                          |
| `BRAND.md`            | Visual direction + asset-generation plan.                           |
| `CONTENT.md`          | Portal links + menu data schema + editor requirements.             |
| `README.md`           | Run locally, deploy, QR/NFC notes.                                  |
| `HANDOFF.md`          | Session-handoff log + open items.                                  |

## Architecture notes (target)

- **No router, no backend.** The portal and menu are separate static pages.
  Links between them are plain `<a href>`. State that matters (current language)
  persists to `localStorage` (`siteLanguage`).
- **i18n.** A single `i18n` object keyed by language (`he`/`en`/`ar`). `t(key)`
  reads from the active language; `setLanguage(lang)` flips `document.dir`
  (`rtl` for `he`/`ar`, `ltr` for `en`), persists the choice, and re-renders.
  **Every new user-facing string must be added to all three language blocks.**
- **Localized content fields.** In `menu-data.js`, an item's `title`/`name`,
  `description`/`note` are objects keyed by language. Read them through a
  `getLocalized()` helper with a fallback chain `he → en → ar`.
- **Prices** are numbers (₪, NIS). Some items legitimately carry a range string
  (e.g. `"14/16"`) — don't assume every price is a number when formatting.
- **The portal is link-only.** No cart, no checkout, no payments in this project
  (unlike the Sarcafe payment gateway). Keep it lean.

## Conventions

- Keep it **dependency-free and build-free.** Prefer vanilla solutions.
- **RTL-first.** Design and test Hebrew/Arabic first, then verify English LTR.
  RTL and LTR break layout in different ways — check both.
- Any new user-facing string → add it to `he`, `en`, **and** `ar`.
- **Motion must be smooth and aesthetic** (an explicit goal). Use a consistent
  easing (`cubic-bezier(0.22, 1, 0.36, 1)`), prefer transform/opacity over
  layout-affecting properties, and always honor
  `@media (prefers-reduced-motion: reduce)`.
- Fixed/floating UI (e.g. language switch) stays pinned to the same physical
  corner regardless of text direction.
- One typeface (Rubik). Don't introduce a second font or a runtime font CDN.
- Generated art is placeholder — keep it swappable. Reference assets by stable
  paths so real artwork can drop in without code changes (see `BRAND.md`).

## Workflow

- Static site → deploy via **GitHub Pages**. Commit to the working branch, then
  fast-forward `main` so the deployed site updates. Don't open PRs unless asked.
- There are no automated tests. Verify visually at desktop (~1280px) and mobile
  (~390px), exercising: language switch (incl. RTL↔LTR), portal button links,
  menu category nav, and the editor's load → edit → save round-trip.
- At the end of a session, update `HANDOFF.md` (check off items, log a short
  dated summary, flag anything needing the owner — real links, artwork).

## Reading order for a new session

1. `HANDOFF.md` — newest entry + open items.
2. `BRAND.md` — visual direction (esp. while there's no real artwork).
3. `CONTENT.md` — the portal links and menu schema you'll be wiring.
