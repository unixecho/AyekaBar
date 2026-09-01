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
  // Unsolicited free text from the public, sometimes carrying a contact
  // address. OP only — being trusted with the MENU has never implied being
  // handed customer correspondence, so this deliberately does NOT follow the
  // editor's wider circle. /api/owner/feedback takes the same view.
  '/owner/feedback',
]

export const MENU_EDITOR_PREFIX = '/owner/editor'

/** Label for the owner UI, so the roster can state the level plainly instead
 *  of making the owner infer it from two separate chips. */
export function accessLabel(row: AccessRow): { he: string; emoji: string; color: string } {
  if (isOp(row)) return { he: 'הרשאות מלאות', emoji: '🔑', color: '#ff8a5c' }
  if (canEditMenu(row)) return { he: 'עריכת תפריט', emoji: '📝', color: '#60a5fa' }
  return { he: 'צוות', emoji: '👤', color: '#a8a5b0' }
}
