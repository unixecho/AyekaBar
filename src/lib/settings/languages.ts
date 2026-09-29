// Which languages the public site offers — pure, safe on server and client.
//
// The site speaks Hebrew, English and Arabic. Hebrew is the base: it is what
// every missing translation falls back to (`loc()` in lib/menu/types goes he →
// en → ar), the default before a visitor has chosen anything, and the language
// the owner writes the menu in. So it cannot be switched off — there would be
// nothing to fall back to. English and Arabic are the two the owner can turn on
// and off from /owner/languages.
//
// Turning a language off hides it from the switcher; it does not delete a word
// of the translations already typed into the menu, so turning it back on brings
// everything back exactly as it was. Exercised by scripts/check-languages.mjs.

import type { Lang } from '@/lib/menu/types'

/** In the order the switcher lists them. */
export const ALL_LANGUAGES: readonly Lang[] = ['he', 'en', 'ar']

export interface SiteLanguages {
  en: boolean
  ar: boolean
}

/** Both on — what the site did before this was a setting. Also what a failed
 *  or missing read resolves to, so a settings hiccup can never quietly remove a
 *  language a customer was using. */
export const SITE_LANGUAGES_DEFAULT: SiteLanguages = { en: true, ar: true }

/** Coerce whatever is stored into a valid value. The row is owner-written but
 *  hand-editable in the SQL editor; anything that isn't an explicit `false`
 *  keeps the language ON, for the same fail-open reason as the default. */
export function normalizeSiteLanguages(raw: unknown): SiteLanguages {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...SITE_LANGUAGES_DEFAULT }
  const o = raw as Record<string, unknown>
  return { en: o.en !== false, ar: o.ar !== false }
}

/** The languages to offer, Hebrew always first. */
export function enabledLanguages(s: SiteLanguages): Lang[] {
  return ['he', ...(s.en ? (['en'] as const) : []), ...(s.ar ? (['ar'] as const) : [])]
}

/**
 * The language to show a visitor whose browser remembers `saved`.
 *
 * A remembered language that has since been switched off resolves to Hebrew
 * WITHOUT being forgotten — the caller must not write this back to storage. If
 * the owner turns it on again the visitor's own choice is still there. Anything
 * unrecognised (an empty value, a language we never had) is Hebrew too.
 */
export function resolveLanguage(saved: string | null | undefined, enabled: readonly Lang[] = ALL_LANGUAGES): Lang {
  return (enabled as readonly string[]).includes(saved ?? '') ? (saved as Lang) : 'he'
}
