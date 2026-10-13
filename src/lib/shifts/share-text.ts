// The words that travel with a shared schedule, and the page they point to.
// Pure — the share sheet puts the text next to the picture or the PDF.

/** The staff schedule page. A signed-out recipient is sent through /login?next=… (which only carries
 *  plain path characters), so the link is a plain path on this site. `origin` is the address bar's
 *  origin when called in the browser; without it the link stays relative. */
export function scheduleLink(origin = ''): string {
  return `${origin.replace(/\/$/, '')}/staff/schedule`
}

/** "לוח משמרות · אייכה בר · 12.10 – 18.10", then the link alone on the last line. */
export function shareMessage(args: { title: string; venueName: string; rangeLabel: string; origin?: string }): string {
  return `${args.title} · ${args.venueName} · ${args.rangeLabel}\n${scheduleLink(args.origin)}`
}

/** A file-name-safe tail for the saved picture or PDF. */
export function fileStem(args: { scope: 'mine' | 'everyone'; weekStart: string }): string {
  return `ayeka-${args.scope === 'mine' ? 'my-shifts' : 'schedule'}-${args.weekStart}`
}
