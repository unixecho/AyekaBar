// The SECOND LOCK on the cart's two server-backed actions — the first lock being the developer's switch
// (`table_ordering_enabled` / `waiter_call_enabled`, read through `actions` in CartProvider).
//
// A switch flipped in the database cannot light up a button whose endpoint does not exist, so each
// constant only moves to `true` in the same change that ships the endpoint it gates. Both are read in more
// than one place now (the footer buttons, the tutorial's privacy sentence), so they live here once.
//
// Typed `boolean` rather than inferred as the literal `true`, so a check like `actions.ordering &&
// PHASE_2_BUILT` reads as a real condition to the compiler and to the next reader.

/** Sending the cart to the waiters after a code: POST /api/table/session + /api/table/order + migration 058.
 *  Flipped 2026-10-13. The switch still ships OFF. */
export const PHASE_2_BUILT: boolean = true

/** "קריאה למלצר": POST /api/table/call + migration 057. Flipped 2026-10-13. The switch still ships OFF. */
export const PHASE_3_BUILT: boolean = true
