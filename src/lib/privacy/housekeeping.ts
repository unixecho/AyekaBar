// ── leftovers from things the site no longer uses ──────────────────────────
// Negishot (a third-party accessibility overlay) was removed 2026-09-12 and left a
// cookie and two kinds of localStorage key on every browser that had seen it;
// `ayeka.shifts.prototype.` (v1 and v2) is the old shift-scheduler demo's storage — v2 became
// legacy on 2026-10-13, when the scheduler rebuild (PR #6) deleted the demo that wrote it.
// It is the staff demo's previous format. Nothing here is
// written by the site any more — `cleanupLegacy` (below) removes it. They live in
// THIS file, not the registry, because LegacyCleanup is mounted in the root layout
// and so ships with every page: it must not drag the registry along.
export const LEGACY_STORAGE_PREFIXES: readonly string[] = ['negishot_', 'ayeka.shifts.prototype.']
export const LEGACY_COOKIE_PREFIXES: readonly string[] = ['negishot']

export const isLegacyStorageKey = (key: string): boolean =>
  LEGACY_STORAGE_PREFIXES.some((p) => key.indexOf(p) === 0)
export const isLegacyCookieName = (name: string): boolean =>
  LEGACY_COOKIE_PREFIXES.some((p) => name.indexOf(p) === 0)

// The two things this site does TO a visitor's storage besides reading and
// writing its own keys: delete it all on request, and tidy away leftovers of
// things it no longer uses.
//
// Both take their environment as an argument instead of reaching for `window`,
// so scripts/check-privacy.mjs can run the real code against fakes — including
// fakes that THROW, because a private window or a browser with storage disabled
// throws on access and neither of these may ever break a page over it.

export interface StorageLike {
  readonly length: number
  clear(): void
  key(index: number): string | null
  removeItem(key: string): void
}

export interface CookieJar {
  /** `document.cookie` — "a=1; b=2". */
  read(): string
  /** Assigns ONE cookie string, as `document.cookie = …` does. */
  write(cookie: string): void
  hostname: string
}

export interface DeviceEnv {
  local?: StorageLike | null
  session?: StorageLike | null
  cookies?: CookieJar | null
}

const safe = <T,>(fn: () => T, fallback: T): T => {
  try { return fn() } catch { return fallback }
}

/** Delete everything this site keeps in the browser's own storage (localStorage
 *  and sessionStorage) — the "delete what this site stored" button.
 *
 *  Deliberately NOT cookies: the only cookies are the sign-in ones, and deleting
 *  a person's session from a privacy page, silently, would be a surprise. Signing
 *  out does that, and the page says so. Returns how many entries were removed so
 *  the page can say something truer than "done". */
export function clearDeviceStorage(env: DeviceEnv): { cleared: number } {
  let cleared = 0
  ;[env.local, env.session].forEach((s) => {
    if (!s) return
    cleared += safe(() => s.length, 0)
    safe(() => s.clear(), undefined)
  })
  return { cleared }
}

/** Remove what older versions of the site (or software it has since dropped)
 *  left behind: the Negishot overlay's cookie and storage keys, the staff demo's
 *  previous format. Idempotent and silent — with nothing to remove it does
 *  nothing, which is nearly every visit. */
export function cleanupLegacy(env: DeviceEnv): { storage: string[]; cookies: string[] } {
  const storage: string[] = []
  const cookies: string[] = []

  ;[env.local, env.session].forEach((s) => {
    if (!s) return
    // Collect first, remove after: removing while walking indexes skips keys.
    const found: string[] = []
    const n = safe(() => s.length, 0)
    for (let i = 0; i < n; i++) {
      const k = safe(() => s.key(i), null)
      if (k && isLegacyStorageKey(k)) found.push(k)
    }
    found.forEach((k) => { safe(() => s.removeItem(k), undefined); storage.push(k) })
  })

  const jar = env.cookies
  if (jar) {
    const names = safe(() => jar.read(), '')
      .split(';')
      .map((c) => c.split('=')[0].trim())
      .filter((n) => n.length > 0 && isLegacyCookieName(n))
    names.forEach((name) => {
      // A cookie is removed only by an expiry that names the same path and
      // domain it was set with, and a script cannot see what those were — so try
      // the host-only form and the two domain forms a widget could have used.
      const base = `${name}=; Max-Age=0; Path=/`
      const host = jar.hostname
      const labels = host.split('.')
      safe(() => jar.write(base), undefined)
      if (labels.length >= 2 && host !== 'localhost') {
        safe(() => jar.write(`${base}; Domain=${host}`), undefined)
        safe(() => jar.write(`${base}; Domain=.${labels.slice(-2).join('.')}`), undefined)
      }
      cookies.push(name)
    })
  }

  return { storage, cookies }
}
