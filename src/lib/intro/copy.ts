// The words of the intro, in the site's three languages. Pure — safe on server
// and client; exercised by scripts/check-intro.mjs.
//
// HEBREW is the owner's own wording, verbatim (2026-10-03). The harness pins it
// so a later "tidy-up" cannot quietly change what the owner wrote. ENGLISH and
// ARABIC are translations written alongside it — worth a read by a native
// speaker before the intro is relied on in those languages.
//
// `*word*` marks the one word of the headline that glows in the brand's coral
// neon. The markers never reach the screen: splitLine() strips them.

import type { Lang } from '@/lib/menu/types'

export interface IntroCopy {
  /** The question. Exactly one highlighted word. */
  line1: string
  /** The invitation. */
  line2: string
  /** The hint for leaving early. */
  skip: string
}

export const INTRO_COPY: Record<Lang, IntroCopy> = {
  he: {
    line1: 'מוכנים להתחיל את חיי *הלילה* שלכם בחריש?',
    line2: 'בואו לשתות קוקטיילים או לאכול ברמה הכי גבוהה שיש',
    skip: 'הקישו כדי לדלג',
  },
  en: {
    line1: 'Ready to start your *nightlife* in Harish?',
    line2: 'Come for cocktails, or dine at the highest level there is.',
    skip: 'Tap to skip',
  },
  ar: {
    line1: 'جاهزون لبدء حياتكم *الليلية* في حريش؟',
    line2: 'تعالوا لتشربوا الكوكتيلات أو لتتناولوا الطعام بأعلى مستوى ممكن',
    skip: 'انقر للتخطي',
  },
}

export interface IntroWord {
  text: string
  /** Glows in the brand's coral. */
  hl: boolean
}

/** A line as the words the screen animates one by one. Punctuation stays on
 *  its word ("בחריש?" is one word, so the question mark can never be left
 *  behind on a line of its own), and the `*` markers are stripped. */
export function splitLine(line: string): IntroWord[] {
  return line
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => ({ text: w.replace(/\*/g, ''), hl: w.indexOf('*') !== -1 }))
    .filter((w) => w.text.length > 0)
}
