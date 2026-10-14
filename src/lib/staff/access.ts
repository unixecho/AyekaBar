// Who can do what. One source of truth — middleware, the API guards, the
// page-level re-checks and the owner UI all read these, so they cannot drift
// apart the way `staff.role` and the menus RLS did.
//
// Three levels:
//
//   OP        role = 'owner'  OR  badge = 'owner'
//             Old-school Minecraft OP: everything, no exceptions. Ownership of
//             the business implies it, so a בעלים badge grants it on its own —
//             showing "בעלים" and "הרשאות" as separate switches was redundant.
//
//   MENU      OP  OR  badge = 'general_manager'
//             The GM is trusted with the menu without being handed OP. They
//             get the editor, versions and Happy Hour — nothing else.
//
//   STAFF     any row in public.staff
//             The employee gateway: the check-in QR screen. A shift manager
//             signs in but never reaches the owner panel.
//
// …and one lens on top of the three, not a fourth level:
//
//   DEV       OP  AND  badge = 'Dev'
//             The developer's own dashboard (/owner/dev): every category the
//             owner sees, the employee experience, and the in-development
//             switches. It grants NOTHING the row's OP rights did not already
//             grant — it is a view, and the `isOp` half of the test is what
//             stops a badge typed onto a non-admin row from opening anything.
//             No SQL twin: nothing in the database asks "is this the dev".

export interface AccessRow {
  role?: string | null
  badge?: string | null
}

/** Full admin. Everything, including staff management and the audit log. */
export function isOp(row: AccessRow | null | undefined): boolean {
  if (!row) return false
  return row.role === 'owner' || row.badge === 'owner'
}

/** May open the menu editor, menu versions and Happy Hour. */
export function canEditMenu(row: AccessRow | null | undefined): boolean {
  if (!row) return false
  return isOp(row) || row.badge === 'general_manager'
}

/** Has any staff access at all — the QR gateway at /staff/dashboard. */
export function isStaff(row: AccessRow | null | undefined): boolean {
  return !!row
}

/** The developer's dashboard and dev-only switches. OP is required as well as
 *  the badge, so a badge alone can never open anything. The badge is compared
 *  case-insensitively because the live row was typed by hand as "Dev". */
export function isDev(row: AccessRow | null | undefined): boolean {
  if (!row || !isOp(row)) return false
  return (row.badge ?? '').trim().toLowerCase() === 'dev'
}

/** Owner-panel sections that are NOT the editor. Kept as a list so middleware
 *  and the dashboard agree on what OP actually gates. */
export const OP_ONLY_PREFIXES = [
  '/owner/dashboard',
  '/owner/customers',
  '/owner/rewards',
  '/owner/audit',
  // Split out of the dashboard 2026-08-29. Each was OP-gated as a card ON
  // that page, so each stays OP-gated as a page — moving a control to its own
  // route must not be the thing that widens who can reach it.
  '/owner/staff',
  '/owner/loyalty',
  '/owner/links',
  // Which languages the public site offers. A site-wide switch, so OP only,
  // like the portal links it sits beside.
  '/owner/languages',
  // The portal's opening screen on/off (and its previews). The front door's
  // appearance — OP only, like the other portal-wide settings above.
  '/owner/intro',
  // Unsolicited free text from the public, sometimes carrying a contact
  // address. OP only — being trusted with the MENU has never implied being
  // handed customer correspondence, so this deliberately does NOT follow the
  // editor's wider circle. /api/owner/feedback takes the same view.
  '/owner/feedback',
  // Found missing 2026-10-13 by scripts/check-dashboard.mjs: both pages already
  // re-check isOp() server-side and always have, but middleware — the FIRST gate
  // — did not know about them, so an anonymous visitor got the page's own
  // redirect instead of the middleware's. Listed now so every OP-only tile on
  // the dashboard is also OP-only at the door.
  '/owner/reports',
  '/owner/accessibility',
  // The daily Z-report archive. The takings of the night — OP only, like the
  // receipts page it sits beside. (Filing one is a different, wider circle:
  // see lib/zreport/rules.ts, reached from the STAFF dashboard.)
  '/owner/z-reports',
  // The payslip library (2026-10-14): everyone's salary documents. OP only, like the archive above — NOT widened to
  // the general manager. An employee reads their OWN at /staff/payslips (a staff prefix, gated by row ownership).
  '/owner/payslips',
]

/** Sections only the developer opens. Also OP-gated by middleware (a dev row
 *  is an OP row), then narrowed by `isDev` — see middleware.ts. */
export const DEV_ONLY_PREFIXES = ['/owner/dev']

export const MENU_EDITOR_PREFIX = '/owner/editor'

/** Label for the owner UI, so the roster can state the level plainly instead
 *  of making the owner infer it from two separate chips. */
export function accessLabel(row: AccessRow): { he: string; emoji: string; color: string } {
  if (isOp(row)) return { he: 'הרשאות מלאות', emoji: '🔑', color: '#ff8a5c' }
  if (canEditMenu(row)) return { he: 'עריכת תפריט', emoji: '📝', color: '#60a5fa' }
  return { he: 'צוות', emoji: '👤', color: '#a8a5b0' }
}
