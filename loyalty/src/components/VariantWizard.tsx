'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loc, type MenuCategory } from '@/lib/menu/types'

// Create / edit a menu version. Two steps, iOS sheet:
//   1. Name it ("יום שישי")
//   2. Turn OFF what this version doesn't serve
//
// Built by SUBTRACTION on purpose. A new version starts with everything on and
// the owner removes what the kitchen isn't doing — unticking 14 items is a
// decision, ticking 38 is a chore. It also means an item added to the menu
// later shows up in every version by default instead of silently vanishing.

const T = {
  createTitle: 'גרסה חדשה',
  editTitle: 'עריכת הגרסה',
  step1: 'איך לקרוא לגרסה?',
  step1Hint: 'למשל: יום שישי, ערב, תפריט מקוצר.',
  namePh: 'שם הגרסה',
  next: 'המשך',
  step2: 'מה מוגש בגרסה הזו?',
  step2Hint: 'הכל דלוק כברירת מחדל — כבה/י את מה שלא מוגש.',
  save: 'שמירה',
  saving: 'שומר…',
  cancel: 'ביטול',
  back: 'חזרה',
  of: (on: number, total: number) => `${on}/${total}`,
  summary: (on: number, total: number) => `${on} מתוך ${total} פריטים מוצגים`,
  nameRequired: 'צריך שם לגרסה',
  noneLeft: 'צריך להשאיר לפחות פריט אחד',
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
  const shownCount = allUids.length - allUids.filter((u) => excluded.has(u)).length

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
      // Any on -> turn the whole category off. All off -> turn it all back on.
      // This is the Friday gesture: kill the kitchen in one tap.
      for (const u of uids) { if (anyOn) next.add(u); else next.delete(u) }
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
      style={{
        position: 'fixed', inset: 0, zIndex: 150,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fade-in .22s var(--ease)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, background: 'var(--bg-elev-2)',
          borderTopLeftRadius: 22, borderTopRightRadius: 22,
          border: '1px solid var(--line-strong)', borderBottom: 'none',
          padding: `14px 16px calc(env(safe-area-inset-bottom) + 16px)`,
          maxHeight: '88dvh', display: 'flex', flexDirection: 'column',
          animation: 'sheet-up .34s var(--ease)',
        }}
      >
        <div aria-hidden style={{
          width: 38, height: 4, borderRadius: 999, background: 'var(--line-strong)',
          margin: '0 auto 14px', flex: '0 0 auto',
        }} />

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
            {err && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: '10px 0 0' }}>{err}</p>}
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
            <p style={{ margin: '0 0 12px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--neon-soft)' }}>
              {T.summary(shownCount, allUids.length)}
            </p>

            <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 4 }}>
              {categories.map((cat) => {
                const uids = (cat.items ?? []).map((i) => i.uid).filter((u): u is string => !!u)
                const onCount = uids.filter((u) => !excluded.has(u)).length
                const all = onCount === uids.length && uids.length > 0
                const none = onCount === 0
                return (
                  <div key={cat.id} style={{
                    border: '1px solid var(--line)', borderRadius: 14,
                    background: 'var(--bg-elev)', overflow: 'hidden',
                    opacity: none ? 0.55 : 1, transition: 'opacity .2s var(--ease)',
                  }}>
                    <button type="button" onClick={() => toggleCategory(cat)} className="press"
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '12px 13px', border: 'none', background: 'transparent',
                        color: 'var(--text)', font: 'inherit', fontWeight: 700,
                        fontSize: '0.92rem', cursor: 'pointer', textAlign: 'start',
                      }}>
                      <span aria-hidden>{cat.icon ?? '🍽️'}</span>
                      <span style={{ flex: 1 }}>{loc(cat.title, 'he')}</span>
                      <span style={{ fontSize: '0.76rem', color: 'var(--text-faint)', fontWeight: 600 }}>
                        {T.of(onCount, uids.length)}
                      </span>
                      <Switch on={all} partial={!all && !none} />
                    </button>

                    <div style={{ borderTop: '1px solid var(--line)' }}>
                      {(cat.items ?? []).map((item) => {
                        if (!item.uid) return null
                        const on = !excluded.has(item.uid)
                        return (
                          <button
                            key={item.uid} type="button" onClick={() => toggleItem(item.uid!)}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                              padding: '11px 13px', border: 'none', background: 'transparent',
                              borderTop: '1px solid rgba(255,255,255,0.03)',
                              color: on ? 'var(--text-dim)' : 'var(--text-faint)',
                              font: 'inherit', fontSize: '0.86rem', cursor: 'pointer', textAlign: 'start',
                              textDecoration: on ? 'none' : 'line-through',
                            }}>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {loc(item, 'he')}
                            </span>
                            <Switch on={on} small />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {err && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: '10px 0 0' }}>{err}</p>}

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

function Switch({ on, partial = false, small = false }: { on: boolean; partial?: boolean; small?: boolean }) {
  const w = small ? 40 : 46
  const h = small ? 24 : 27
  const knob = h - 6
  return (
    <span aria-hidden style={{
      flex: '0 0 auto', width: w, height: h, borderRadius: 999, direction: 'ltr',
      display: 'flex', alignItems: 'center', padding: 3,
      border: `1px solid ${on || partial ? 'transparent' : 'var(--line-strong)'}`,
      background: on
        ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
        : partial ? 'rgba(255,94,58,0.35)' : 'var(--bg-elev-2)',
      transition: 'background .25s var(--ease)',
    }}>
      <span style={{
        width: knob, height: knob, borderRadius: 999, background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        transform: `translateX(${on ? w - knob - 8 : partial ? (w - knob - 8) / 2 : 0}px)`,
        transition: 'transform .26s var(--ease)',
      }} />
    </span>
  )
}

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
