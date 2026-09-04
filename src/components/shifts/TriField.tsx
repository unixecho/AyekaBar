'use client'

import { useEffect, useId, useState } from 'react'
import { useShifts } from '@/components/shifts/ShiftsProvider'
import type { Tri } from '@/lib/shifts/types'

// One labelled input per language — Hebrew required, English/Arabic
// optional — with the `he → en → ar` fallback shown inline, so an owner who
// only fills in Hebrew can see exactly what an English reader will get
// instead of discovering it later on the staff view.
//
// Local draft + explicit commit on blur/Enter, same pattern as
// DisplayNameField in StaffManager.tsx — a catalog rename must not fire a
// write (and an audit line) on every keystroke. Escape reverts.
//
// This is the control that makes "each owner will want to call it
// differently" real (the user's own words, 2026-08-20) — every catalog name
// in the scheduler goes through this component, never a plain <input>.

export default function TriField({ value, onCommit, disabled, autoFocus }: {
  value: Tri
  onCommit: (next: Tri) => void
  disabled?: boolean
  autoFocus?: boolean
}) {
  const { t } = useShifts()
  const [draft, setDraft] = useState<Tri>(value)
  useEffect(() => { setDraft(value) }, [value])

  const commit = () => {
    const trimmed: Tri = { he: draft.he.trim(), en: draft.en.trim(), ar: draft.ar.trim() }
    if (trimmed.he === value.he && trimmed.en === value.en && trimmed.ar === value.ar) return
    setDraft(trimmed)
    onCommit(trimmed)
  }

  const revert = () => setDraft(value)

  const fallback = draft.he.trim() || draft.en.trim() || draft.ar.trim() || '—'
  const showFallback = !draft.en.trim() || !draft.ar.trim()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Field
        lang="he" required dir="rtl" label={t('langHebrew')}
        value={draft.he} disabled={disabled} autoFocus={autoFocus}
        onChange={(v) => setDraft((d) => ({ ...d, he: v }))}
        onCommit={commit} onRevert={revert}
      />
      <Field
        lang="en" dir="ltr" label={t('langEnglish')}
        value={draft.en} disabled={disabled}
        onChange={(v) => setDraft((d) => ({ ...d, en: v }))}
        onCommit={commit} onRevert={revert}
      />
      <Field
        lang="ar" dir="rtl" label={t('langArabic')}
        value={draft.ar} disabled={disabled}
        onChange={(v) => setDraft((d) => ({ ...d, ar: v }))}
        onCommit={commit} onRevert={revert}
      />
      {showFallback && (
        <p className="sh-sub" style={{ margin: 0 }}>
          {t('willShowAs')} <strong style={{ color: 'var(--text-dim)' }}>{fallback}</strong>
        </p>
      )}
    </div>
  )
}

function Field({
  lang, label, value, required, dir, disabled, autoFocus, onChange, onCommit, onRevert,
}: {
  lang: string; label: string; value: string; required?: boolean; dir: 'rtl' | 'ltr'
  disabled?: boolean; autoFocus?: boolean
  onChange: (v: string) => void; onCommit: () => void; onRevert: () => void
}) {
  const { t } = useShifts()
  // A11y (WCAG 3.3.2 / 4.1.2): the <label> and <input> were siblings with
  // no htmlFor/id — the only <label> in the whole shifts module with this
  // bug (grep-verified), used for every catalog name field (role/preset/
  // station x 3 languages) in CatalogEditor.tsx. No accessible name at all.
  const id = useId()
  return (
    <div>
      <label htmlFor={id} style={{
        display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-faint)',
        marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.02em',
      }}>
        {label}{!required && <span style={{ opacity: 0.7 }}> · {t('optional')}</span>}
      </label>
      <input
        id={id}
        value={value} disabled={disabled} dir={dir} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { onRevert(); e.currentTarget.blur() }
        }}
        style={{
          width: '100%', padding: '9px 11px', borderRadius: 10,
          border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
          color: 'var(--text)', fontSize: '0.86rem', fontFamily: 'inherit', outline: 'none',
        }}
        data-lang={lang}
      />
    </div>
  )
}
