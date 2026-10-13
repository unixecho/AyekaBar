// Where the customer-facing accessibility widget is allowed to exist — split
// out of components/A11yGate.tsx so the rule is PURE and can be checked by
// scripts/check-dashboard.mjs without loading a React component.
//
// Owner, 2026-10-13: "make sure the accessibility widget is disabled in the
// dashboard for all users, the accessibility widget should work only for
// Customer Facing pages."
//
// A PREFIX LIST OF WHERE IT IS OFF, not an allow-list of where it is on: a new
// customer-facing page should get the widget by default (forgetting to list it
// would silently strip an accessibility feature from the public), while a new
// back-office page lives under /owner or /staff by the same rule that already
// gates it in middleware.ts.

export const A11Y_DISABLED_PREFIXES = ['/owner', '/staff'] as const

export function a11yDisabledOn(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return A11Y_DISABLED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
