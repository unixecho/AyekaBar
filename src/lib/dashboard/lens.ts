// The developer's single dashboard has three views — "lenses" (2026-10-15). Pure: the page, the switcher and the
// harness (scripts/check-dashboard.mjs) all read this one list.
//
// Owner: "for my dev account: instead of having 3 different perspectives give me one perspective that has all 3
// views: Owner/Manager, Employee, Developer."

export type Lens = 'manager' | 'employee' | 'dev'

/** In the order the owner named them. */
export const LENSES: readonly { id: Lens; icon: string; he: string }[] = [
  { id: 'manager',  icon: '⚙️',  he: 'מנהל' },
  { id: 'employee', icon: '🧑‍🍳', he: 'עובד' },
  { id: 'dev',      icon: '🛠️',  he: 'מפתח' },
]

/** Which view opens when the URL does not say. The developer's own tools: this is the page sign-in lands on, and the
 *  health check is what a developer opens it for. */
export const DEFAULT_LENS: Lens = 'dev'

/** `?view=` from the URL, made safe. Anything that is not one of the three is the default. */
export function parseLens(v: unknown): Lens {
  const s = Array.isArray(v) ? v[0] : v
  return LENSES.some((l) => l.id === s) ? (s as Lens) : DEFAULT_LENS
}
