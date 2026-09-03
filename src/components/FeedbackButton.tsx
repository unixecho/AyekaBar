'use client'

import { useState, type CSSProperties } from 'react'
import { haptic } from '@/lib/haptics'
import type { Lang } from '@/lib/menu/types'
import { FEEDBACK_UI } from '@/lib/feedback/i18n'
import FeedbackSheet from '@/components/FeedbackSheet'

// The portal's one entry point into the feedback box (PLAN_CUSTOMER_FEEDBACK
// §6): "positioned near the footer, after the review CTA, so it reads as
// 'something else you can do here' rather than competing with the primary
// navigate/menu/loyalty actions."
//
// Which is also why it is deliberately the QUIETEST control on the page. The
// review CTA immediately above it is gold, shimmering and asking for a public
// five stars — the thing the business actually wants from a happy customer.
// This one is for the other conversation, the private one, and dressing it
// up to compete would put "tell us what went wrong" next to "tell everyone
// what went right" as equals.
//
// Renders nothing when the owner has closed the box. That is display only —
// POST /api/feedback re-reads the same switch and refuses on its own, because
// a hidden button is not a closed endpoint.

export default function FeedbackButton({
  lang, enabled, variant = 'card',
}: {
  lang: Lang
  enabled: boolean
  /** 'card' — the portal's full-width entry point. 'link' — a plain
   *  underlined trigger, sized to sit in a page footer next to the
   *  accessibility-statement link (WCAG 2.2 3.2.6 Consistent Help: /menu
   *  needs the SAME way to reach feedback the portal has, not a second
   *  bespoke control). Both open the identical FeedbackSheet — only the
   *  trigger's chrome differs. */
  variant?: 'card' | 'link'
}) {
  const [open, setOpen] = useState(false)
  if (!enabled) return null

  return (
    <>
      {variant === 'link' ? (
        <button
          type="button"
          className="press"
          onClick={() => { haptic(); setOpen(true) }}
          aria-haspopup="dialog"
          aria-expanded={open}
          style={linkBtn}
        >
          {FEEDBACK_UI.open[lang]}
        </button>
      ) : (
        <button
          type="button"
          className="press"
          onClick={() => { haptic(); setOpen(true) }}
          aria-haspopup="dialog"
          aria-expanded={open}
          style={btn}
        >
          <span style={icWrap} aria-hidden>
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor"
              strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-4.6A8 8 0 1 1 21 12z" />
              <path d="M9 11h6" /><path d="M9 14.5h3.5" />
            </svg>
          </span>
          <span style={{ flex: 1, textAlign: 'start' }}>{FEEDBACK_UI.open[lang]}</span>
        </button>
      )}

      <FeedbackSheet
        open={open}
        onClose={() => setOpen(false)}
        lang={lang}
        // Matches useLanguage()'s own rule in LanguageSwitch.tsx: English is
        // the only LTR language this site speaks.
        dir={lang === 'en' ? 'ltr' : 'rtl'}
      />
    </>
  )
}

const btn: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 15,
  border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)',
  color: 'var(--text-dim)', fontWeight: 600, fontSize: '0.95rem',
  fontFamily: 'inherit', cursor: 'pointer', width: '100%',
}

const icWrap: CSSProperties = {
  width: 26, display: 'grid', placeItems: 'center', color: 'var(--text-faint)', flex: '0 0 auto',
}

/** Matches the accessibility-statement link's own footer treatment
 *  (Portal.tsx / MenuView.tsx) — same size, same underline, same muted
 *  color — so the two sit as visible equals in a footer, not one styled
 *  like an afterthought next to the other. */
const linkBtn: CSSProperties = {
  border: 0, background: 'none', padding: 0, margin: 0,
  color: 'var(--text-faint)', textDecoration: 'underline',
  font: 'inherit', fontSize: '0.8rem', cursor: 'pointer',
}
