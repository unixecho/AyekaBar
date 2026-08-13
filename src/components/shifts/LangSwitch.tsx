'use client'

import { useShifts } from '@/components/shifts/ShiftsProvider'
import type { Lang } from '@/lib/shifts/types'

// A three-way language toggle for the schedule surfaces.
//
// The portal and the menu already have one (components/LanguageSwitch.tsx),
// but that one is a floating globe pinned to a corner of a public page — the
// wrong shape for a dense tool with a toolbar. This writes the same
// `siteLanguage` key, so a manager who switches here finds the menu in the
// same language, and vice versa.

const NAMES: Record<Lang, string> = { he: 'עב', en: 'EN', ar: 'ع' }
const ORDER: Lang[] = ['he', 'en', 'ar']

export default function LangSwitch() {
  const { lang, setLang } = useShifts()

  return (
    <div
      className="sh-noprint"
      role="radiogroup"
      aria-label="Language"
      style={{
        display: 'inline-flex', gap: 2, padding: 2, borderRadius: 999,
        border: '1px solid var(--line)', background: 'var(--bg-elev-2)',
        // Pinned LTR so the three options keep the same physical order in
        // every language — a control that reorders itself when you use it is
        // the one control that must not.
        direction: 'ltr',
      }}
    >
      {ORDER.map((l) => {
        const active = l === lang
        return (
          <button
            key={l} type="button" role="radio" aria-checked={active}
            onClick={() => setLang(l)}
            style={{
              padding: '4px 9px', borderRadius: 999, border: 'none',
              background: active ? 'rgba(255,94,58,0.18)' : 'transparent',
              color: active ? 'var(--neon-soft)' : 'var(--text-faint)',
              font: 'inherit', fontSize: '0.72rem', fontWeight: 700,
              cursor: 'pointer', lineHeight: 1.6,
            }}
          >
            {NAMES[l]}
          </button>
        )
      })}
    </div>
  )
}
