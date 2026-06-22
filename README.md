# אייכה בר — Portal & Digital Menu

Portal website and trilingual digital menu for **אייכה בר** (Eicha Bar), a bar in
**Harish (חריש)**, Israel.

- **Portal** (`index.html`) — the brand's link hub: navigate to us, digital
  menu, Instagram, leave a review. This is the headline product.
- **Digital menu** (`menu.html`) — browsable menu in Hebrew / English / Arabic,
  reached from the portal and from printed **QR codes** and **NFC chips**.
- **Editor** (`editor.html`) — owner tool to edit the menu without code.

Hebrew is the primary language; the site is **RTL-first** with English/Arabic
support. Built as a dependency-free static site (vanilla HTML/CSS/JS, no build
step).

> **Status:** project context/instructions only at this stage. Start with
> `CLAUDE.md`, then `BRAND.md` and `CONTENT.md`. No artwork exists yet — visuals
> are generated placeholders (see `BRAND.md`).

## Documentation

| File         | What's in it                                                        |
| ------------ | ------------------------------------------------------------------- |
| `CLAUDE.md`  | Project overview, tech stack, file map, architecture, conventions.  |
| `BRAND.md`   | Dark/neon visual direction, palette, type, motion, asset plan.      |
| `CONTENT.md` | Portal links, menu data schema, editor requirements.                |
| `HANDOFF.md` | Session log + open items (incl. owner actions).                     |

## Run locally

No build step. Because the menu data is a plain JS file, you can usually open
`index.html` directly — but a static server is recommended (and required if any
page switches to `fetch()`):

```bash
# any static server works:
python3 -m http.server 8000
# or
npx serve
```

Then visit `http://localhost:8000/`. The editor is at `/editor.html`.

## Deploy — GitHub Pages

The site is plain static files, so GitHub Pages serves it as-is:

1. Push the repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The site publishes at `https://<user>.github.io/<repo>/` (or a custom domain
   if configured).
4. Commit to the working branch, then fast-forward `main` and push so Pages
   redeploys.

## QR codes & NFC

Printed QR-code stands and NFC chips on tables point **directly to the digital
menu** (`.../menu.html`), not the portal — fewer taps to the thing a seated
customer wants. The portal is the brand hub people reach from Instagram, cards,
and search.

- Encode the **full deployed menu URL** (with `https://`) in both the QR and the
  NFC chip.
- Generate QR codes only after the final URL/domain is locked, so reprints
  aren't needed.
- Test scans on both iOS and Android, and an NFC tap, before printing a batch.
