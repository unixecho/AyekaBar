# Session Handoff

Running log of work on this project. At the **end of each session**:

1. Check off completed items in **Backlog / open items**.
2. Add a dated entry to the **Session log** with a short summary.
3. Flag anything still open or needing the owner (real links, artwork,
   decisions).

> Tip: start a session by skimming the top **Session log** entry and the open
> items below.

---

## Backlog / open items

Unchecked = not done yet. Owner actions are marked **(owner)**.

### Owner inputs

- [ ] **(owner)** Address / GPS coordinates of the bar (for the navigation
      button — Waze + Google Maps).
- [ ] **(owner)** Instagram handle.
- [ ] **(owner)** Google Place ID (for the direct "leave a review" link).
- [ ] **(owner)** The real menu — items, prices, categories (Hebrew); en/ar can
      be translated from it.
- [ ] **(owner)** Confirm the **Arabic spelling** of "אייכה בר" (docs use a
      provisional transliteration, `إيخا بار`) — and review the Arabic menu
      translations overall.
- [ ] **(owner)** **קומבינציה סטולי (₪570)** — the printed menu describes it as
      "בקבוק בלוגה …" (same as the ₪750 Beluga combo). Kept as printed for now
      (possible print error). Confirm whether it should be a Stoli bottle.
- [ ] **(owner)** Final **logo / wordmark**, brand colors, and **photos** when
      available — to replace generated placeholders.

### Build (not started — this pass is docs only)

- [ ] Generate placeholder brand assets (logo, favicon, icons, item
      placeholder, og-image) per `BRAND.md`.
- [ ] Self-host Rubik woff2 subsets in `assets/fonts/` + `@font-face`.
- [ ] Build `index.html` portal (4 action buttons, language switch, entrance
      motion).
- [ ] Build `menu.html` + `menu-data.js` + `menu.js` (trilingual menu).
- [ ] Build `editor.html` + `editor.js` (validated load → edit → save of
      `menu-data.js`).
- [ ] Wire real portal links once owner provides them.
- [ ] Lock deployed URL/domain, then generate QR codes + program NFC chips.

---

## Session log

### 2026-06-22 — Portal (index.html)

- Built `index.html`: brand wordmark + four action buttons (ניווט אלינו,
  תפריט דיגיטלי [hero], אינסטגרם, השארת ביקורת), matching the menu's dark/neon
  system and the same globe language switcher + `localStorage` "siteLanguage"
  (language carries between portal and menu).
- Entrance animation: logo blooms, brand + buttons rise with a stagger; slow
  ambient drift behind. Honors prefers-reduced-motion.
- Links: Digital menu → `menu.html` (internal). The other three are constants at
  the top of the inline script, currently `#` placeholders pending owner inputs
  (maps/coords, Instagram, Google review link).
- Verified: inline JS passes `node --check`; DOM-stub harness confirms 4 buttons,
  hero=menu→menu.html, rtl "חריש · ישראל" → ltr "Harish · Israel" on switch.

### 2026-06-22 — Digital menu page (menu.html)

- Built `menu.html`: trilingual (he/en/ar) RTL-first digital menu reading from
  `menu-data.js` (single source of truth), matching the portal's dark/neon look.
- Five requested tweaks implemented: (1) **accordion** — one category open at a
  time, opening one collapses the rest; (2) **globe language switcher** that
  expands on click to reveal עברית / English / العربية (persists to
  `localStorage` "siteLanguage", click-outside / Esc to close); (3) **sticky,
  centered category slider** — active chip auto-centers; (4) **solid item cards**
  for legibility over the ambient background; (5) renders the full rich menu.
- Verified: inline JS passes `node --check`; a DOM-stub harness renders all
  19 categories / 97 items, confirms one section open at load, accordion keeps
  only one open, and language switch flips dir + labels (rtl "אייכה בר" → ltr
  "Eicha Bar"). No browser screenshot — sandbox blocks npm/puppeteer; eyeball
  locally to confirm visuals.
- **TODO:** `menu.html` currently loads Rubik from Google Fonts. Per `BRAND.md`,
  swap to self-hosted woff2 subsets in `assets/fonts/` before launch (the portal
  should use the same).

### 2026-06-22 — Project context & instructions

- Established the **context/instruction layer** for the project (no site code
  yet). Decisions captured with the owner:
  - **Scope this pass:** docs/context only.
  - **Aesthetic:** dark & moody / neon (nightlife, warm-ember primary accent
    with a sparing electric-cyan secondary).
  - **Hosting:** GitHub Pages.
- Studied prior sites (Sarcafe-Portal, Sarcafe Payment Gateway,
  CoffeeTruckQRWebsite) and matched their conventions: vanilla HTML/CSS/JS, no
  build step, trilingual he/en/ar RTL-first, self-hosted Rubik, menu data in a
  JS file, standalone owner editor, placeholder assets, project docs.
- Wrote: `CLAUDE.md` (overview, stack, file map, architecture, conventions),
  `BRAND.md` (palette, typography, motion, asset-generation plan), `CONTENT.md`
  (portal links + menu schema + editor requirements), `README.md` (run/deploy/
  QR-NFC), and this `HANDOFF.md`.
- **Open:** all owner inputs above; the build backlog is the next phase.
- Status: docs written to the project folder.
