'use client'

import type { CSSProperties } from 'react'
import SheetShell from '@/components/cart/SheetShell'
import { haptic } from '@/lib/haptics'
import { useA11y } from './A11yProvider'
import { a11yT } from '@/lib/a11y/i18n'
import { FONT_SCALE_STEPS, SPACING_STEPS, CONTRAST_MODES, type ContrastMode } from '@/lib/a11y/types'

// The control sheet. Built on SheetShell — the cart's real focus trap and
// scroll lock — rather than a fourth bespoke overlay, same precedent
// FeedbackSheet.tsx already set for reusing it outside src/components/cart.
//
// Every control here is a plain <button>, never a native <input
// type="range">/<select> — this codebase's house rule is iOS-native-style
// controls over browser-native ones, and a stepper/switch/radiogroup reads
// correctly with VoiceOver/TalkBack without needing a bespoke label dance a
// <select> would.

const CONTRAST_LABEL_KEY: Record<ContrastMode, 'contrastDefault' | 'contrastHigh' | 'contrastGrayscale' | 'contrastInvert'> = {
  default: 'contrastDefault', high: 'contrastHigh', grayscale: 'contrastGrayscale', invert: 'contrastInvert',
}

export default function A11yPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, set, reset, lang, dir } = useA11y()
  const t = (k: Parameters<typeof a11yT>[0]) => a11yT(k, lang)

  return (
    <SheetShell open={open} onClose={onClose} label={t('title')} dir={dir}>
      <div className="sheet-scroll" style={{ gap: 18, paddingTop: 6 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>
            {t('title')}
          </h2>
          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
            {t('intro')}
          </p>
        </div>

        <Section title={t('textSection')}>
          <Stepper
            label={t('fontScale')}
            value={prefs.fontScale}
            max={FONT_SCALE_STEPS.length - 1}
            onChange={(v) => set('fontScale', v as typeof prefs.fontScale)}
            lang={lang}
          />
          <Stepper
            label={t('spacing')}
            value={prefs.spacing}
            max={SPACING_STEPS.length - 1}
            onChange={(v) => set('spacing', v as typeof prefs.spacing)}
            lang={lang}
          />
        </Section>

        <Section title={t('appearanceSection')}>
          <div role="radiogroup" aria-label={t('contrast')} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {CONTRAST_MODES.map((mode) => {
              const active = prefs.contrast === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className="press"
                  onClick={() => { haptic('select'); set('contrast', mode) }}
                  style={{ ...choiceBtn, ...(active ? choiceBtnActive : null) }}
                >
                  {t(CONTRAST_LABEL_KEY[mode])}
                </button>
              )
            })}
          </div>
        </Section>

        <Section title={t('motionSection')}>
          <Switch label={t('pauseAnimations')} checked={prefs.pauseAnimations} onChange={(v) => set('pauseAnimations', v)} lang={lang} />
          <Switch label={t('readingGuide')} checked={prefs.readingGuide} onChange={(v) => set('readingGuide', v)} lang={lang} />
          <Switch label={t('highlightLinks')} checked={prefs.highlightLinks} onChange={(v) => set('highlightLinks', v)} lang={lang} />
          <Switch label={t('highlightHeadings')} checked={prefs.highlightHeadings} onChange={(v) => set('highlightHeadings', v)} lang={lang} />
          <Switch label={t('bigCursor')} checked={prefs.bigCursor} onChange={(v) => set('bigCursor', v)} lang={lang} />
        </Section>
      </div>

      <div style={{ paddingTop: 12, display: 'flex', gap: 8 }}>
        <button type="button" className="press" onClick={() => { haptic('tick'); reset() }} style={{ ...secondaryBtn, flex: 1 }}>
          {t('reset')}
        </button>
        <button type="button" className="press" onClick={onClose} style={{ ...primaryBtn, flex: 1 }}>
          {t('close')}
        </button>
      </div>
    </SheetShell>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <legend style={{ padding: 0, marginBottom: 4, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-faint)' }}>
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

/** −/value/+ — visually and structurally the same pattern as the cart's own
 *  .cart-step (AddToCartControl.tsx), including the persistent aria-live
 *  span; reused rather than re-derived, since that pattern was already
 *  fixed once (A9) to announce correctly. */
function Stepper({
  label, value, max, onChange, lang,
}: {
  label: string; value: number; max: number; onChange: (v: number) => void
  lang: Parameters<typeof a11yT>[1]
}) {
  const dec = () => { if (value > 0) { haptic('tick'); onChange(value - 1) } }
  const inc = () => { if (value < max) { haptic('tick'); onChange(value + 1) } }
  return (
    // wrap, not nowrap: at a larger --a11y-font-scale the label can outgrow
    // the row before the stepper does (found live-testing this panel with
    // its own font-size control turned up — the row overflowed
    // horizontally instead of dropping the stepper to its own line).
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, rowGap: 6 }}>
      <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)', minWidth: 0 }}>{label}</span>
      <div className="cart-step" role="group" aria-label={label} style={{ direction: 'ltr', flex: '0 0 auto' }}>
        <button type="button" className="cart-step-btn" onClick={dec} disabled={value === 0}
          aria-label={a11yT('decrease', lang)}>−</button>
        <span className="cart-step-qty" aria-live="polite" aria-atomic="true">{value + 1}</span>
        <button type="button" className="cart-step-btn" onClick={inc} disabled={value === max}
          aria-label={a11yT('increase', lang)}>+</button>
      </div>
    </div>
  )
}

/** A real `role="switch"`, not a checkbox styled to look like one — reads
 *  correctly on VoiceOver/TalkBack without extra ARIA plumbing. */
function Switch({
  label, checked, onChange, lang,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void
  lang: Parameters<typeof a11yT>[1]
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="press"
      onClick={() => { haptic('select'); onChange(!checked) }}
      style={switchRow}
    >
      <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text)', minWidth: 0 }}>{label}</span>
      {/* Both spans below are aria-hidden: role="switch" + aria-checked
          already gives assistive tech "switch, on/off" on their own, and
          without this the two spans concatenate into the accessible name
          with no separator ("עצירת אנימציותכבוי") — found live-testing this
          panel, same category of thing A9/A10 were about. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-hidden>
        <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>
          {checked ? a11yT('on', lang) : a11yT('off', lang)}
        </span>
        <span className="a11y-switch-track" data-on={checked}>
          <span className="a11y-switch-thumb" />
        </span>
      </span>
    </button>
  )
}

const choiceBtn: CSSProperties = {
  padding: '10px 8px', borderRadius: 12, border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)', color: 'var(--text)', fontFamily: 'inherit',
  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
}
const choiceBtnActive: CSSProperties = {
  borderColor: 'var(--neon)', background: 'rgba(255,94,58,0.12)', boxShadow: '0 0 18px rgba(255,94,58,0.16)',
}
const switchRow: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', width: '100%',
  gap: 12, rowGap: 6,
  border: 0, background: 'none', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit',
}
const primaryBtn: CSSProperties = {
  padding: '13px 0', borderRadius: 14, border: '1px solid transparent',
  background: 'linear-gradient(135deg, rgba(255,94,58,0.9), rgba(255,138,92,0.75))',
  color: '#fff', fontSize: '0.95rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
}
const secondaryBtn: CSSProperties = {
  padding: '13px 0', borderRadius: 14,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
  color: 'var(--text)', fontSize: '0.95rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
