// The dashboards' one registry — every tile, its category, and who may see it.
//
// WHY ONE FILE (2026-10-13). The owner's dashboard grew to twelve flat tiles,
// the staff dashboard was a QR code and two buttons, and the developer wanted
// "all the categories" in one place. Three hand-written pages would drift the
// first time a page moved; one registry, filtered per viewer, cannot. The three
// dashboards are three VIEWS over this list:
//
//   /staff/dashboard   → the `mywork` category, plus any `menu`-audience tiles
//                         the viewer is allowed (the GM's editor, the floor)
//   /owner/dashboard   → operations · content · people · system (OP)
//   /owner/dev         → everything, in the same order, plus `dev`
//
// A tile's `audience` is a SHOW/HIDE rule for the UI. It is not authorization —
// middleware.ts, the page's own server-side re-check and the API guards are the
// gate, and `scripts/check-dashboard.mjs` fails if a tile's audience is wider
// than the prefix list that protects its route (a tile that leads to a wall).

import {
  canEditMenu, isDev, isOp, DEV_ONLY_PREFIXES, MENU_EDITOR_PREFIX, OP_ONLY_PREFIXES,
  type AccessRow,
} from '../staff/access'
import { canManageFloor, FLOOR_PREFIXES } from '../waiter/access'

/** Where the POS (the order-management app) lives. */
export const OMS_URL = 'https://staff.ayeka.bar'

export type CategoryId = 'mywork' | 'operations' | 'content' | 'people' | 'system' | 'dev'

/** Who a tile is shown to. */
export type Audience = 'staff' | 'floor' | 'menu' | 'op' | 'dev'

export interface Category {
  id: CategoryId
  icon: string
  he: string
  /** One line under the heading — what lives here. */
  hint: string
}

export interface Tile {
  id: string
  category: CategoryId
  audience: Audience
  href: string
  icon: string
  he: string
  /** Optional second line on the tile. */
  hint?: string
  /** A different app / site. Rendered as a plain <a>, never a client-side
   *  <Link> (PageTransitions only owns same-origin navigation). */
  external?: boolean
  /** Open in a new tab. Used for the dev's reference links; the POS opens in
   *  the same tab on purpose — it is the app a shift is spent in. */
  newTab?: boolean
}

/** Order here is the order on screen. */
export const CATEGORIES: Category[] = [
  { id: 'mywork',     icon: '🧑‍🍳', he: 'העבודה שלי',       hint: 'המשמרות, הקופה והמועדון' },
  { id: 'operations', icon: '⚙️',   he: 'תפעול שוטף',       hint: 'סידור, שולחנות, קבלות ודוחות' },
  { id: 'content',    icon: '🍽️',   he: 'תפריט ותוכן',      hint: 'מה שהלקוחות רואים באתר' },
  { id: 'people',     icon: '👥',   he: 'צוות ולקוחות',     hint: 'מי עובד כאן ומי חוזר אלינו' },
  { id: 'system',     icon: '🛡️',   he: 'מערכת ונגישות',    hint: 'הצהרות, יומן שינויים והגדרות' },
  { id: 'dev',        icon: '🛠️',   he: 'כלי מפתח',         hint: 'מתגי פיצ\'רים, בדיקות וקישורים' },
]

export const TILES: Tile[] = [
  // ── העבודה שלי — the employee experience, for everyone ───────────────
  { id: 'my-shifts', category: 'mywork', audience: 'staff', href: '/staff/schedule', icon: '🗓️', he: 'המשמרות שלי', hint: 'הסידור שפורסם' },
  { id: 'pos',       category: 'mywork', audience: 'staff', href: OMS_URL,            icon: '🧾', he: 'מערכת קופה',    hint: 'הזמנות ושולחנות', external: true },
  { id: 'loyalty',   category: 'mywork', audience: 'staff', href: '/staff/loyalty',   icon: '🎁', he: 'מועדון נאמנות', hint: 'קוד הצבירה ללקוח' },
  // Locked ("בקרוב") by the staff dashboard until migration 060 is applied — see staff/dashboard/page.tsx.
  { id: 'payslips',  category: 'mywork', audience: 'staff', href: '/staff/payslips',  icon: '💵', he: 'תלושי שכר',    hint: 'צפייה והורדה' },

  // ── תפעול שוטף ──────────────────────────────────────────────────────
  { id: 'schedule',  category: 'operations', audience: 'menu',  href: '/owner/schedule',  icon: '📅', he: 'ניהול סידור עבודה', hint: 'שיבוץ ופרסום' },
  { id: 'floor',     category: 'operations', audience: 'floor', href: '/owner/floor',     icon: '🗺️', he: 'מפת השולחנות',      hint: 'סידור החדר' },
  { id: 'reports',   category: 'operations', audience: 'op',    href: '/owner/reports',   icon: '🧮', he: 'קבלות ומשמרות',     hint: 'פתיחה וסגירה של משמרת' },
  { id: 'z-reports', category: 'operations', audience: 'op',    href: '/owner/z-reports', icon: '📑', he: 'דוח Z יומי',        hint: 'סגירת הקופה בכל לילה' },

  // ── תפריט ותוכן ─────────────────────────────────────────────────────
  { id: 'editor',    category: 'content', audience: 'menu', href: MENU_EDITOR_PREFIX,  icon: '🍽️', he: 'תפריט',        hint: 'עריכה ופרסום' },
  { id: 'links',     category: 'content', audience: 'op',   href: '/owner/links',      icon: '🔗', he: 'קישורי פורטל', hint: 'הכפתורים בעמוד הבית' },
  { id: 'languages', category: 'content', audience: 'op',   href: '/owner/languages',  icon: '🌐', he: 'שפות האתר',    hint: 'אנגלית וערבית' },
  { id: 'intro',     category: 'content', audience: 'op',   href: '/owner/intro',      icon: '🎬', he: 'מסך פתיחה',    hint: 'הפתיחה של עמוד הבית' },

  // ── צוות ולקוחות ────────────────────────────────────────────────────
  { id: 'staff',     category: 'people', audience: 'op', href: '/owner/staff',    icon: '👥', he: 'ניהול צוות',     hint: 'הוספה, הרשאות, חשבונות' },
  { id: 'loyalty-admin', category: 'people', audience: 'op', href: '/owner/loyalty', icon: '💎', he: 'מועדון נאמנות', hint: 'מתג, פרסים, נקודות' },
  { id: 'feedback',  category: 'people', audience: 'op', href: '/owner/feedback', icon: '💬', he: 'משוב מלקוחות',   hint: 'עסקי וטכני' },
  { id: 'payslips-admin', category: 'people', audience: 'op', href: '/owner/payslips', icon: '💰', he: 'תלושי שכר', hint: 'העלאה, צפייה והורדה' },

  // ── מערכת ונגישות ───────────────────────────────────────────────────
  { id: 'accessibility', category: 'system', audience: 'op', href: '/owner/accessibility', icon: '♿', he: 'הצהרת נגישות', hint: 'הטקסט הציבורי' },
  { id: 'audit',     category: 'system', audience: 'op', href: '/owner/audit', icon: '🧾', he: 'יומן שינויים', hint: 'מי שינה מה' },

  // ── כלי מפתח ────────────────────────────────────────────────────────
  { id: 'dev-demo',     category: 'dev', audience: 'dev', href: `${OMS_URL}/?demo=1`, icon: '🎛️', he: 'תצוגת על (דמו)', hint: 'קופה, בר ומטבח יחד', external: true, newTab: true },
  { id: 'dev-supabase', category: 'dev', audience: 'dev', href: 'https://supabase.com/dashboard/project/uemnappyzjqntildlhlr', icon: '🗄️', he: 'Supabase', hint: 'מסד הנתונים', external: true, newTab: true },
  { id: 'dev-vercel',   category: 'dev', audience: 'dev', href: 'https://vercel.com/dashboard', icon: '▲', he: 'Vercel', hint: 'פריסות ולוגים', external: true, newTab: true },
  { id: 'dev-github',   category: 'dev', audience: 'dev', href: 'https://github.com/unixecho/AyekaBar', icon: '🐙', he: 'GitHub — האתר', hint: 'unixecho/AyekaBar', external: true, newTab: true },
  { id: 'dev-github-oms', category: 'dev', audience: 'dev', href: 'https://github.com/unixecho/Ayeka-Bar-Order-Management-System', icon: '🐙', he: 'GitHub — הקופה', hint: 'ayeka-staff', external: true, newTab: true },
]

/** Does the viewer see tiles of this audience? Pure; takes the access row. */
export function canSee(audience: Audience, row: AccessRow | null | undefined): boolean {
  if (!row) return false
  switch (audience) {
    case 'staff': return true
    case 'floor': return canManageFloor(row)
    case 'menu':  return canEditMenu(row)
    case 'op':    return isOp(row)
    case 'dev':   return isDev(row)
  }
}

export interface Section { category: Category; tiles: Tile[] }

/** The sections one dashboard shows: only the listed categories, only the
 *  tiles the viewer may see, and no empty section. `exclude` drops whole
 *  audiences — the staff dashboard passes ['op', 'dev'] so an owner who opens
 *  the employee view gets the EMPLOYEE view, not a second copy of their own
 *  dashboard. */
export function sectionsFor(
  row: AccessRow | null | undefined, categories: CategoryId[], exclude: Audience[] = [],
): Section[] {
  return CATEGORIES
    .filter((c) => categories.includes(c.id))
    .map((category) => ({
      category,
      tiles: TILES.filter(
        (t) => t.category === category.id && !exclude.includes(t.audience) && canSee(t.audience, row),
      ),
    }))
    .filter((s) => s.tiles.length > 0)
}

/** The Z-report door. NOT in TILES: it exists only while the 23:00 window is
 *  open and the viewer is someone who may file (lib/zreport/rules.ts), so the
 *  staff dashboard adds it per request — the form is not "shown" at any other
 *  hour, which is the owner's rule. */
export const Z_REPORT_TILE: Tile = {
  id: 'z-report', category: 'mywork', audience: 'staff', href: '/staff/z-report',
  icon: '📑', he: 'העלאת דוח Z', hint: 'סגירת הקופה של הלילה',
}

/** Which dashboard shows which categories — one place, so the pages and the
 *  harness agree. */
export const STAFF_CATEGORIES: CategoryId[] = ['mywork', 'operations', 'content']
/** …with these audiences removed (see sectionsFor). */
export const STAFF_EXCLUDE: Audience[] = ['op', 'dev']
export const OWNER_CATEGORIES: CategoryId[] = ['operations', 'content', 'people', 'system']
export const DEV_CATEGORIES: CategoryId[] = ['mywork', 'operations', 'content', 'people', 'system', 'dev']

/** The route-protection prefixes a tile's href must sit behind for its
 *  audience, used by the harness: a tile shown to MORE people than the route's
 *  gate admits is a tile that leads to /no-access. */
export const AUDIENCE_PROTECTION: Record<Audience, string[] | null> = {
  staff: null,               // any staff row (or an external app)
  floor: FLOOR_PREFIXES,
  menu: [MENU_EDITOR_PREFIX, '/owner/schedule'], // the schedule page re-checks per venue
  op: OP_ONLY_PREFIXES,
  dev: DEV_ONLY_PREFIXES,
}
