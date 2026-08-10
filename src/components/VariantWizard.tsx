'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loc, type MenuCategory } from '@/lib/menu/types'
import TempMenuSheet, { type TempSetting } from '@/components/TempMenuSheet'
import Switch from '@/components/Switch'
import TimeWheel from '@/components/TimeWheel'
import ModalPortal from '@/components/ModalPortal'

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
  badWindow: 'שעת ההתחלה והסיום זהות',
  expand: 'פתיחה',
  rename: 'שם הגרסה',
  schedTitle: 'תזמון אוטומטי',
  schedHint: 'הגרסה תיכנס לתוקף לבד בימים ובשעות שנבחרו, ותחזור לתפריט הרגיל כשהחלון נסגר.',
  schedDays: 'ימים',
  schedDaysHint: 'בלי בחירה — כל יום.',
  schedFrom: 'משעה',
  schedTo: 'עד שעה',
  schedOvernight: 'החלון ימשיך אחרי חצות',
  schedManual: 'ללא תזמון — הגרסה מוצגת רק כשבוחרים אותה ידנית.',
  tempTitle: 'להפעיל עכשיו, לזמן מוגבל',
  tempHint: 'הגרסה תעלה לאוויר ברגע השמירה ותרד לבד בשעה שתבחר/י.',
  tempOff: 'הגרסה תישמר בלבד. אפשר להפעיל אותה מתי שרוצים.',
  tempSet: 'עד',
  tempDeletes: 'ותימחק בסיום',
  tempChange: 'שינוי',
  defaultScope: 'זהו התפריט הראשי — מה שמסומן כאן הוא מה שמוצג כברירת מחדל.',
}

export interface VariantSchedule {
  enabled: boolean
  /** JS getDay(): 0=Sunday … 5=Friday. Empty = every day. */
  days: number[]
  start: string
  end: string
}

const DAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

export default function VariantWizard({
  categories, initialName, initialExcluded, initialSchedule, variantId,
  isDefault = false, timersReady = true, onClose, onSaved,
}: {
  categories: MenuCategory[]
  initialName: string
  initialExcluded: string[]
  initialSchedule: VariantSchedule
  /** null = creating */
  variantId: string | null
  /** The fallback everything reverts to: it can be scoped and renamed, but
   *  never scheduled or put on a timer — there'd be nothing left to fall
   *  back TO. */
  isDefault?: boolean
  /** False on a database without migration 017 — hides the timer card rather
   *  than offering one that can only fail on save. */
  timersReady?: boolean
  onClose: () => void
  /** Receives the saved row's id — creating returns a NEW id, editing returns
   *  the same one — so the caller can keep it selected after the reload. */
  onSaved: (id: string) => void | Promise<void>
}) {
  // Editing jumps straight to the content step, but the name stays editable
  // there — renaming shouldn't mean recreating the version.
  const [step, setStep] = useState<1 | 2>(variantId ? 2 : 1)
  const [name, setName] = useState(initialName)
  const [sched, setSched] = useState<VariantSchedule>(initialSchedule)
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
  // Only offered while CREATING. Retiming a version that already exists belongs
  // on the version row, next to the chip that shows the countdown.
  const [temp, setTemp] = useState<TempSetting | null>(null)
  const [tempOpen, setTempOpen] = useState(false)
  const offerTemp = !isDefault && !variantId && timersReady

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
    // Applies to the main version too, now that it can hide items — an empty
    // menu is never what anyone meant.
    if (shownCount === 0) { setErr(T.noneLeft); return }
    if (!isDefault && sched.enabled && sched.start === sched.end) { setErr(T.badWindow); return }

    setSaving(true); setErr(null)
    try {
      // The main version takes a name and a scope, but never a schedule or a
      // timer — sending either would be rejected, and rightly so.
      const payload = isDefault
        ? { nameHe: trimmed, excludedUids: Array.from(excluded) }
        : {
          nameHe: trimmed, excludedUids: Array.from(excluded), schedule: sched,
          ...(offerTemp && temp ? { temp } : {}),
        }
      const res = await fetch('/api/owner/menu-variants', {
        method: variantId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variantId ? { id: variantId, ...payload } : payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'שמירה נכשלה')
      await onSaved((json.variant?.id as string | undefined) ?? variantId ?? '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalPortal>
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
                {/* Rename in place — no need to recreate a version to fix a typo. */}
                <div className="pick-cat" style={{ padding: 12 }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)', marginBottom: 6 }}>
                    {T.rename}
                  </label>
                  <input
                    value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
                    placeholder={T.namePh}
                    style={{
                      width: '100%', padding: '11px 12px', borderRadius: 11,
                      border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
                      color: 'var(--text)', fontSize: '0.94rem', fontFamily: 'inherit', outline: 'none',
                    }}
                  />
                </div>

                {/* Temporary activation — the "no cook tonight" path. Offered
                    only on creation, because a version that already exists is
                    timed from its chip, where the countdown lives. */}
                {offerTemp && (
                <div className="pick-cat" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>{T.tempTitle}</div>
                      <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                        {temp ? T.tempHint : T.tempOff}
                      </p>
                    </div>
                    <button type="button" role="switch" aria-checked={!!temp} aria-label={T.tempTitle}
                      onClick={() => (temp ? setTemp(null) : setTempOpen(true))}
                      className="press" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
                      <Switch on={!!temp} />
                    </button>
                  </div>

                  {temp && (
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="temp-badge">
                        ⏳ {T.tempSet} {new Intl.DateTimeFormat('he-IL', {
                          timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
                        }).format(new Date(temp.until))}
                        {temp.deleteOnExpiry ? ` · ${T.tempDeletes}` : ''}
                      </span>
                      <button type="button" onClick={() => setTempOpen(true)} className="press"
                        style={{ ...ghostBtn, marginInlineStart: 'auto' }}>{T.tempChange}</button>
                    </div>
                  )}
                </div>
                )}

                {isDefault && (
                  <p style={{
                    margin: 0, padding: '10px 12px', borderRadius: 11,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)',
                    color: 'var(--text-faint)', fontSize: '0.78rem', lineHeight: 1.5,
                  }}>{T.defaultScope}</p>
                )}

                {/* Automatic schedule */}
                {!isDefault && (
                <div className="pick-cat" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>{T.schedTitle}</div>
                      <p style={{ margin: '3px 0 0', fontSize: '0.75rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                        {sched.enabled ? T.schedHint : T.schedManual}
                      </p>
                    </div>
                    <button type="button" role="switch" aria-checked={sched.enabled}
                      onClick={() => setSched((s) => ({ ...s, enabled: !s.enabled }))}
                      className="press" style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
                      aria-label={T.schedTitle}>
                      <Switch on={sched.enabled} />
                    </button>
                  </div>

                  {sched.enabled && (
                    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div>
                        <label style={labelStyle}>{T.schedDays}</label>
                        <div className="hh-percent-grid">
                          {DAY_LABELS.map((d, i) => {
                            const on = sched.days.includes(i)
                            return (
                              <button key={i} type="button" className="press hh-percent-btn"
                                data-on={on ? 'true' : undefined}
                                onClick={() => setSched((s) => ({
                                  ...s,
                                  days: on ? s.days.filter((x) => x !== i) : [...s.days, i].sort(),
                                }))}>{d}</button>
                            )
                          })}
                        </div>
                        <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                          {T.schedDaysHint}
                        </p>
                      </div>

                      <div className="time-pair">
                        <div>
                          <label style={labelStyle}>{T.schedFrom}</label>
                          <TimeWheel value={sched.start}
                            onChange={(v) => setSched((s) => ({ ...s, start: v }))} />
                        </div>

                        <div>
                          <label style={labelStyle}>{T.schedTo}</label>
                          <TimeWheel value={sched.end}
                            onChange={(v) => setSched((s) => ({ ...s, end: v }))} />
                        </div>
                      </div>

                      {sched.end <= sched.start && (
                        <p style={{
                          margin: 0, padding: '10px 12px', borderRadius: 11,
                          background: 'rgba(255,94,58,0.10)', border: '1px solid rgba(255,94,58,0.28)',
                          color: 'var(--neon-soft)', fontSize: '0.78rem', fontWeight: 600,
                        }}>⌛ {T.schedOvernight}</p>
                      )}
                    </div>
                  )}
                </div>
                )}

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

        {tempOpen && (
          <TempMenuSheet
            variantName={name.trim() || T.namePh}
            initial={temp}
            confirmLabel={T.save}
            allowClear={!!temp}
            onCancel={() => setTempOpen(false)}
            onClear={() => { setTemp(null); setTempOpen(false) }}
            onConfirm={(value) => { setTemp(value); setTempOpen(false) }}
          />
        )}
      </div>
    </ModalPortal>
  )
}

const labelStyle: CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 700,
  color: 'var(--text-dim)', marginBottom: 7,
}
const errStyle: CSSProperties = { color: '#ff6b6b', fontSize: '0.82rem', margin: '10px 0 0' }
const ghostBtn: CSSProperties = {
  padding: '6px 11px', borderRadius: 10, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text-dim)', fontSize: '0.78rem',
  fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
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
