// The pure rules behind staff push: when a reminder falls due and where tapping an alert goes.
// No server-only imports on purpose, so scripts/check-staff-push.mjs runs the real code.

/** An upcoming-shift alert goes out once the shift is this close. */
export const SHIFT_SOON_MINUTES = 60

/** Where tapping the alert goes. A link.url the app wrote itself wins (only a plain same-origin path
 *  is honoured, so a stored value can never become an open redirect); otherwise the schedule opens. */
export function pushPathFor(_kind: string, link: Record<string, unknown> | null): string {
  const url = link?.url
  if (typeof url === 'string' && /^\/(?!\/)[A-Za-z0-9/_\-?=&%.]*$/.test(url)) return url
  return '/staff/schedule'
}
