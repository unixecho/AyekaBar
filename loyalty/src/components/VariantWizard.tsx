'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loc, type MenuCategory } from '@/lib/menu/types'

// Create / edit a menu version. Two steps:
//   1. Name it ("יום שישי")
//   2. Turn OFF what this version doesn't serve
//
// Built by SUBTRACTION on purpose. A new version starts with everything on and
// the owner removes what the kitchen isn't doing — unticking 14 items is a
// decision, ticking 38 is a chore. Storing exclusions also means an item added
// later shows up in every version instead of silently going missing.
//
// Categories are COLLAPSED by default. The real menu is ~19 categories and
// ~99 items; rendering all of it at once produced an unusable wall. A category
// only opens when the owner wants to touch individual items, and one that's
// been partly switched off opens itself so the difference is never hidden.

const T = {
  createTitle: 'גרסה חדשה',
  editTitle: 'עריכת הגרסה',
  step1: 'איך לקרוא לגרסה?',
  step1Hint: 'למשל: יום שישי, ערב, תפריט מקוצר.',
  namePh: 'שם הגרסה',
  next: 'המשך',
  step2: 'מה מוגש בגרסה הזו?',
  step2Hint: 'הכל דלוק כברירת מחדל. כבה/י קטגוריה שלמה, או פתח/י אותה כדי לבחור פריטים.',
  save: 'שמירה',
  saving: 'שומר…',
  cancel: 'ביטול',
  back: 'חזרה',
  summary: (on: number, total: number) => `${on} מתוך ${total} פריטים מוצגים`,
  nameRequired: 'צריך שם לגרסה',
  noneLeft: 'צריך להשאיר לפחות פריט אחד',
  allOn: 'הכל',
  allOff: 'כבוי',
  expand: 'פתיחה',
}

export default function VariantWizard({
  categories, initialName, initialExcluded, variantId, onClose, onSaved,
}: {
  categories: MenuCategory[]
  initialName: string
  initialExcluded: string[]
  /** null = creating */
  variantId: string | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [step, setStep] = useState<1 | 2>(variantId ? 2 : 1)
  const [name, setName] = useState(initialName)
  const [excluded, setExcluded] = useState<Set<string>>(new Set(initialExcluded))
  const [open, setOpen] = useState<Set<string>>(() => {
    // Open the categories that already differ from "everything on", so an
    // existing version shows its exceptions immediately.
    const hidden = new Set(initialExcluded)
    const s = new Set<string>()
    for (const c of categories) {
      if ((c.items ?? []).some((i) => i.uid && hidden.has(i.uid))) s.add(c.id)
    }
    return s
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, saving])

  const allUids = useMemo(
    () => categories.flatMap((c) => (c.items ?? []).map((i) => i.uid).filter((u): u is string => !!u)),
    [categories],
  )
  const shownCount = allUids.filter((u) => !excluded.has(u)).length

  function toggleItem(uid: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid); else next.add(uid)
      return next
    })
  }

  function toggleCategory(cat: MenuCategory) {
    const uids = (cat.items ?? []).map((i) => i.uid).filter((u): u is string => !!u)
    const anyOn = uids.some((u) => !excluded.has(u))
    setExcluded((prev) => {
      const next = new Set(prev)
      // Any on -> turn the whole category off. All off -> turn it back on.
      // This is the Friday gesture: clear the kitchen in one tap.
      for (const u of uids) { if (anyOn) next.add(u); else next.delete(u) }
      return next
    })
  }

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) { setErr(T.nameRequired); setStep(1); return }
    if (shownCount === 0) { setErr(T.noneLeft); return }

    setSaving(true); setErr(null)
    try {
      const payload = { nameHe: trimmed, excludedUids: Array.from(excluded) }
      const res = await fetch('/api/owner/menu-variants', {
        method: variantId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variantId ? { id: variantId, ...payload } : payload),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label={variantId ? T.editTitle : T.createTitle}
      onClick={() => !saving && onClose()}
      className="sheet-scrim"
    >
      <div onClick={(e) => e.stopPropagation()} className="sheet-panel">
        <div aria-hidden className="sheet-grabber" />

        {step === 1 ? (
          <div style={{ animation: 'fade-in .25s var(--ease)' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>{T.step1}</h3>
            <p style={{ margin: '4px 0 14px', fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {T.step1Hint}
            </p>
            <input
              autoFocus value={name} maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) setStep(2) }}
              placeholder={T.namePh}
              style={{
                width: '100%', padding: '13px 14px', borderRadius: 13,
                border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
                color: 'var(--text)', fontSize: '1rem', fontFamily: 'inherit', outline: 'none',
              }}
            />
            {err && <p style={errStyle}>{err}</p>}
            <button type="button" disabled={!name.trim()} onClick={() => { setErr(null); setStep(2) }}
              className="press" style={{ ...primary, marginTop: 14, opacity: name.trim() ? 1 : 0.5 }}>
              {T.next}
            </button>
            <button type="button" onClick={onClose} className="press" style={cancel}>{T.cancel}</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, animation: 'fade-in .25s var(--ease)' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>{T.step2}</h3>
            <p style={{ margin: '4px 0 4px', fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {T.step2Hint}
            </p>
            <p style={{ margin: '0 0 12px', fontSize: '0.82rem', fontWeight: 700, color: 'var(--neon-soft)' }}>
              {T.summary(shownCount, allUids.length)}
            </p>

            <div className="sheet-scroll">
              {categories.map((cat) => {
                const uids = (cat.items ?? []).map((i) => i.uid).filter((u): u is string => !!u)
                if (!uids.length) return null
                const onCount = uids.filter((u) => !excluded.has(u)).length
                const all = onCount === uids.length
                const none = onCount === 0
                const isOpen = open.has(cat.id)

                return (
                  <div key={cat.id} className="pick-cat" data-off={none ? 'true' : undefined}>
                    <div className="pick-cat-head">
                      {/* Chevron opens the category; the toggle flips it all.
                          Two separate targets so neither is a mystery tap. */}
                      <button type="button" onClick={() => toggleOpen(cat.id)}
                        className="pick-expand press" aria-expanded={isOpen}
                        aria-label={T.expand} title={T.expand}>
                        <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor"
                          strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .25s var(--ease)' }}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>

                      <span className="pick-cat-icon" aria-hidden>{cat.icon ?? '🍽️'}</span>
                      <span className="pick-cat-name">{loc(cat.title, 'he')}</span>
                      <span className="pick-count" dir="ltr">{onCount}/{uids.length}</span>

                      <button type="button" onClick={() => toggleCategory(cat)}
                        role="switch" aria-checked={!none} className="press"
                        aria-label={loc(cat.title, 'he')} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
                        <Switch on={all} partial={!all && !none} />
                      </button>
                    </div>

                    {isOpen && (
                      <div className="pick-items">
                        {(cat.items ?? []).map((item) => {
                          if (!item.uid) return null
                          const on = !excluded.has(item.uid)
                          return (
                            <button key={item.uid} type="button" onClick={() => toggleItem(item.uid!)}
                              className="pick-item" data-off={on ? undefined : 'true'}
                              role="switch" aria-checked={on}>
                              <span className="pick-item-name">{loc(item, 'he')}</span>
                              <Switch on={on} small />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {err && <p style={errStyle}>{err}</p>}

            <div style={{ flex: '0 0 auto', paddingTop: 12 }}>
              <button type="button" onClick={save} disabled={saving} className="press"
                style={{ ...primary, opacity: saving ? 0.6 : 1 }}>
                {saving ? T.saving : T.save}
              </button>
              <button type="button" onClick={() => (variantId ? onClose() : setStep(1))}
                disabled={saving} className="press" style={cancel}>
                {variantId ? T.cancel : T.back}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Switch({ on, partial = false, small = false }: {
  on: boolean; partial?: boolean; small?: boolean
}) {
  const w = small ? 40 : 46
  const h = small ? 24 : 28
  const knob = h - 6
  const travel = w - knob - 8
  return (
    <span aria-hidden style={{
      flex: '0 0 auto', width: w, height: h, borderRadius: 999, direction: 'ltr',
      display: 'inline-flex', alignItems: 'center', padding: 3, boxSizing: 'border-box',
      border: `1px solid ${on || partial ? 'transparent' : 'var(--line-strong)'}`,
      background: on
        ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
        : partial ? 'rgba(255,94,58,0.40)' : 'var(--bg-elev-2)',
      transition: 'background .25s var(--ease)',
    }}>
      <span style={{
        width: knob, height: knob, borderRadius: 999, background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        transform: `translateX(${on ? travel : partial ? travel / 2 : 0}px)`,
        transition: 'transform .26s var(--ease)',
      }} />
    </span>
  )
}

const errStyle: CSSProperties = { color: '#ff6b6b', fontSize: '0.82rem', margin: '10px 0 0' }
const primary: CSSProperties = {
  width: '100%', padding: '14px 0', borderRadius: 14, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  boxShadow: 'var(--glow)', color: '#fff', fontSize: '1rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const cancel: CSSProperties = {
  width: '100%', marginTop: 8, padding: '13px 0', borderRadius: 14,
  border: '1px solid var(--line)', background: 'transparent',
  color: 'var(--text-dim)', fontSize: '0.95rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
}
