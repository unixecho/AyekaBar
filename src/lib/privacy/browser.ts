import type { DeviceEnv } from './housekeeping'
import { ACK_KEY, INVENTORY_VERSION, serializeAck } from './notice'

// The real browser, shaped the way housekeeping.ts wants it. Client-only — call
// it from an event handler or an effect, never during render.
//
// This is the ONE place in the app that assigns to `document.cookie`, and it
// only ever does so on behalf of housekeeping.ts, whose three writes are all
// expiries (Max-Age=0). scripts/check-privacy.mjs holds both halves of that.
//
// Each part is fetched on its own and may be null, because merely TOUCHING
// `window.localStorage` throws in some contexts (storage blocked by policy, a
// sandboxed frame) — and one blocked part must not stop the others.

const get = <T>(read: () => T): T | null => {
  try { return read() } catch { return null }
}

export function browserEnv(): DeviceEnv {
  return {
    local: get(() => window.localStorage),
    session: get(() => window.sessionStorage),
    cookies: {
      read: () => document.cookie,
      write: (cookie: string) => { document.cookie = cookie },
      hostname: window.location.hostname,
    },
  }
}

/** Record that the visitor has seen the storage notice — or the full page behind
 *  it — for THIS inventory. Called by the notice's "Got it" and by the /cookies
 *  page when it opens; it is the same record either way. Never throws. */
export function acknowledgeNotice(): void {
  try {
    window.localStorage.setItem(ACK_KEY, serializeAck(INVENTORY_VERSION, Date.now()))
  } catch {
    /* A private window cannot remember: the notice will show again next time,
       which is acceptable — and better than hiding it where nothing is kept. */
  }
}
