// Permanently deleting a person (2026-10-15) — the PURE half. scripts/check-hard-delete.mjs runs this file.
//
// Owner: "give the dev an option to hard delete users so managers can only deactivate."
//
// THE RULE: managers (OP) can only DEACTIVATE (DELETE /api/owner/staff — a soft delete, restorable). Only the
// developer can DELETE FOR GOOD, through its own route (POST /api/owner/dev/staff, `requireDev`), and only a person
// who has ALREADY been deactivated (the roster's "הוסרו" list) — two deliberate steps, never one mis-tap.
//
// WHAT "FOR GOOD" MEANS, because a person who has worked a shift is referenced by half the database
// (`registered_by`, `claimed_by`, `waiter_staff_id`, … — ON DELETE NO ACTION, so a row delete is refused):
//   1. the person's login is deleted (their Google account in our auth system, and the loyalty profile under it);
//   2. the roster row is deleted if nothing references it (a person who never worked an order);
//   3. if orders and events still point at it, the row is kept as an ANONYMOUS TOMBSTONE — no name, no email, no
//      photo, no way in — so the till history and the money still add up. Nothing personal remains; the order
//      records are not destroyed (they are the bar's books, not the person's data).
//   Payslips are the exception: they are personal payroll records held under an ON DELETE RESTRICT, and deleting the
//   person must never silently take them or orphan them, so the delete is REFUSED until they are dealt with.

/** What an anonymised row is called. The roster hides rows wearing it (see `isTombstone`). */
export const TOMBSTONE_FIRST_NAME = 'עובד'
export const TOMBSTONE_LAST_NAME = 'שנמחק'

export interface HardDeleteRow {
  id: string
  auth_user_id: string | null
  role: string
  active: boolean
}

export type HardDeleteRefusal = 'not_found' | 'self' | 'owner' | 'still_active' | 'has_payslips'

/** Why a hard delete must not run, or null when it may. Order matters: the most basic reason is reported first. */
export function hardDeleteRefusal(
  row: HardDeleteRow | null,
  ctx: { actorAuthUserId: string; payslips: number },
): HardDeleteRefusal | null {
  if (!row) return 'not_found'
  if (row.auth_user_id && row.auth_user_id === ctx.actorAuthUserId) return 'self'
  // Owners are administrators: removing one is a different decision from clearing out a test account, and the
  // last-owner guard lives on the soft-delete route. A developer who really means it demotes the person first.
  if (row.role === 'owner') return 'owner'
  if (row.active) return 'still_active'
  if (ctx.payslips > 0) return 'has_payslips'
  return null
}

export const HARD_DELETE_STATUS: Record<HardDeleteRefusal, number> = {
  not_found: 404, self: 400, owner: 403, still_active: 409, has_payslips: 409,
}

export const HARD_DELETE_MESSAGES: Record<HardDeleteRefusal, string> = {
  not_found: 'לא מצאנו את האדם הזה. רעננו ונסו שוב.',
  self: 'אי אפשר למחוק את עצמך.',
  owner: 'אי אפשר למחוק בעלים. אפשר להסיר את ההרשאות שלו/ה קודם.',
  still_active: 'קודם מסירים את האדם מהצוות, ואז אפשר למחוק לצמיתות.',
  has_payslips: 'יש לאדם הזה תלושי שכר. הורידו אותם ומחקו אותם מספריית התלושים לפני שמוחקים את האדם.',
}

/** Postgres "this row is still referenced" — the signal to anonymise instead of delete. */
export function isForeignKeyViolation(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!err && (err.code === '23503' || /foreign key|violates .* constraint/i.test(err.message ?? ''))
}

/** The columns an anonymised row is left with. No name, no address, no photo, off the public page, no login. */
export function tombstonePatch() {
  return {
    first_name: TOMBSTONE_FIRST_NAME,
    last_name: TOMBSTONE_LAST_NAME,
    display_name: null,
    email: null,
    photo_url: null,
    initial: null,
    show_on_site: false,
    active: false,
    auth_user_id: null,
    claimed_at: null,
  } as const
}

/** True for a row `tombstonePatch()` produced. The roster does not list these: there is nobody to restore. */
export const isTombstone = (row: { first_name?: string | null; last_name?: string | null; active?: boolean | null; email?: string | null }): boolean =>
  row.active === false && !row.email && row.first_name === TOMBSTONE_FIRST_NAME && row.last_name === TOMBSTONE_LAST_NAME

export type HardDeleteMode = 'deleted' | 'anonymized'

/** The sentence shown after it ran. */
export function hardDeleteDone(mode: HardDeleteMode, authDeleted: boolean): string {
  const base = mode === 'deleted'
    ? 'נמחק/ה לצמיתות.'
    : 'נמחק/ה לצמיתות. היו הזמנות על שמו/ה, אז נשארה רשומה אנונימית בלי שם ובלי פרטים כדי שההיסטוריה תישאר שלמה.'
  return authDeleted ? base : `${base} חשבון ה-Google שלו/ה לא נמחק (הוא קשור להיסטוריה אחרת) — הגישה לצוות הוסרה בכל מקרה.`
}
