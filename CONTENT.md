# CONTENT.md

The content layer: what the **portal** links to, and how the **menu** data and
**editor** are structured.

---

## 1. The portal (`index.html`)

The portal is a link hub. It shows the brand and a small set of primary action
buttons. Initial set (Hebrew label = source of truth):

| # | Hebrew (primary) | English          | Arabic            | Action                                                |
| - | ---------------- | ---------------- | ----------------- | ----------------------------------------------------- |
| 1 | ניווט אלינו      | Navigate to us   | الوصول إلينا       | Opens maps directions to the bar (Waze + Google Maps).|
| 2 | תפריט דיגיטלי    | Digital menu     | القائمة الرقمية    | Internal link to `menu.html`.                         |
| 3 | אינסטגרם         | Instagram        | إنستغرام           | Opens the bar's Instagram profile.                    |
| 4 | השארת ביקורת     | Leave a review   | اترك تقييماً        | Opens the Google review / write-a-review link.        |

Design notes:

- Buttons stack vertically on mobile (primary layout), centered under the brand.
- "Digital menu" is the visual hero of the four (it's what QR/NFC also points
  to). Give it slightly more weight.
- Each button has a neon line icon (see `BRAND.md` → `assets/icons/`).
- Language switch pinned to a fixed corner (same physical corner in RTL and
  LTR).

### Link configuration

Keep all external destinations as named constants at the top of `portal.js`, so
the owner can swap them in one place. **All four are placeholders until the
owner confirms** (track in `HANDOFF.md`):

```js
const LINKS = {
  // Navigation — prefer geo coords so both apps resolve the exact spot.
  wazeUrl:      "https://waze.com/ul?ll=<LAT>,<LNG>&navigate=yes", // ⚠️ placeholder
  googleMaps:   "https://www.google.com/maps/dir/?api=1&destination=<LAT>,<LNG>", // ⚠️ placeholder
  instagram:    "https://instagram.com/<HANDLE>",   // ⚠️ placeholder
  review:       "https://search.google.com/local/writereview?placeid=<PLACE_ID>", // ⚠️ placeholder
};
```

Owner inputs needed: exact **address / coordinates**, **Instagram handle**, and
the **Google Place ID** (for the direct "write a review" deep link). A "navigate"
button may present a small chooser (Waze / Google Maps) since both are common in
Israel.

---

## 2. The digital menu (`menu.html` + `menu-data.js`)

### Data schema

`menu-data.js` exports an array of **categories**, each holding **items**.
Localized fields are `{ he, en, ar }`. Hebrew is required; en/ar fall back to
Hebrew if missing.

```js
"use strict";

// Menu content for אייכה בר. Primary language Hebrew; English + Arabic supported.
//
// Category: { id, icon, title: {he,en,ar}, note?: {he,en,ar}, items: [...] }
// Item:     { he, en, ar, price, note?: {he,en,ar}, badges?, image?, available? }
//
// Photos are not ready yet — items with no `image` fall back to
// assets/menu-item-placeholder.svg. To add a photo, drop the file in assets/
// and set the item's `image`.

// Badges highlight standout items. On an item, list keys from BADGES, e.g.
// `badges: ["new"]`, `badges: ["mustTry"]`, or both `badges: ["new","mustTry"]`.
const BADGES = {
  new:     { he: "חדש", en: "New", ar: "جديد" },
  mustTry: { he: "חובה לטעום", en: "Must try", ar: "يجب تجربته" },
};

const CATEGORIES = [
  {
    id: "cocktails",
    icon: "🍸",
    title: { he: "קוקטיילים", en: "Cocktails", ar: "كوكتيلات" },
    // Optional category note — shown under the title. Use for serving-size or
    // shared-pricing explanations (e.g. "glass / pitcher").
    note: { he: "כוס / קנקן", en: "Glass / pitcher", ar: "كأس / إبريق" },
    items: [
      {
        he: "שם הקוקטייל",
        en: "Cocktail name",
        ar: "اسم الكوكتيل",
        price: 48,
        note: { he: "תיאור קצר", en: "Short description", ar: "وصف قصير" },
        // badges: ["mustTry"],    // optional: any of "new" / "mustTry" (see BADGES)
        // image: "assets/cocktail-x.jpg",
        // available: true,        // optional; false = show as sold out / hide
      },
    ],
  },
  // ...more categories
];

// Single source for the page:
const MENU = {
  name: { he: "אייכה בר", en: "Eicha Bar", ar: "إيخا بار" }, // ⚠️ confirm Arabic
  badges: BADGES,
  categories: CATEGORIES,
};
```

Field rules:

- `id` — short, unique, `camelCase`, stable (used for in-page category nav /
  anchors). Don't rename an existing id casually.
- `icon` — an emoji or an `assets/icons/*` reference; consistent style.
- `price` — number in **₪ (NIS)**. A **variant/range string** (e.g. `"52/208"`
  glass/pitcher, `"30/34"` third/half, `"49/139"` glass/bottle) is allowed —
  formatting code must tolerate strings. `null` = price not set yet (ask owner).
- `note` — optional localized sub-line (description, condition, e.g. "winter
  only", "60 ml").
- `badges` — optional array of keys (`"new"`, `"mustTry"`); each renders a
  highlight chip. An item may carry both. Labels come from the `BADGES` map
  (localized he/en/ar). Editable per item in the editor (two checkboxes).
- Category-level `note` (optional) — a localized line under the category title,
  used for shared pricing/serving notes (e.g. chasers "1 for ₪18 | 4 for ₪50",
  draft beer "third / half liter").
- `image` — optional path; absent → placeholder.
- `available` — optional; lets the owner mark an item sold-out without deleting
  it.

Suggested starting categories for a bar (owner adjusts): cocktails, beer,
wine, shots/spirits, non-alcoholic, food/snacks. The real list comes from the
owner's menu.

### Menu page behavior (`menu.js`)

- Render categories in order with a sticky category nav (tap to jump / scroll).
- Language switch flips `document.dir` and re-renders; persists to
  `localStorage` (`siteLanguage`). Shared with the portal.
- Items show name, optional note, price, and image/placeholder.
- Smooth entrance/scroll motion per `BRAND.md`; reduced-motion safe.

---

## 3. The menu editor (`editor.html` + `editor.js`)

A standalone, dependency-free owner tool (like our Sarcafe/CoffeeTruck
managers). Marked `noindex`. Goal: the owner edits the menu without touching
code, and the output is always a clean, valid `menu-data.js`.

Requirements:

- **Load** the live `menu-data.js` and show every category and item in a guided
  form.
- **Edit / add / duplicate / delete / reorder** categories and items.
- All three languages editable per field; **Hebrew required** (block save if a
  Hebrew name is missing).
- **Validation** before save: unique category ids, valid id format, Hebrew name
  present, price is a number or a valid range string, well-formed `note`/`image`.
- **Safe serialization:** always re-serialize from validated, normalized objects
  in the repo's exact field order with a trailing newline — never hand-patch the
  file, so it can't be saved half-broken.
- **Save:** File System Access API (Chrome/Edge) to write `menu-data.js` in
  place; **download fallback** elsewhere.
- **Unsaved-changes guard** before leaving.
- New categories creatable inline (camelCase id + the three localized titles).

---

## Owner inputs checklist (track in HANDOFF.md)

- [ ] Address / GPS coordinates for navigation links.
- [ ] Instagram handle.
- [ ] Google Place ID (for direct review link).
- [ ] The actual menu (items, prices, categories) in Hebrew — en/ar can be
      translated from it.
- [ ] Confirm Arabic spelling of "אייכה בר".
- [ ] Logo / photos when available.
