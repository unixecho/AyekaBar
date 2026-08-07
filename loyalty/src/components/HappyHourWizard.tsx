'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loc, type MenuCategory } from '@/lib/menu/types'
import { type HappyHour, type HappyHourRule } from '@/lib/menu/variants'

// Full-screen, two-stage onboarding — deliberately NOT a sheet. Setting up a
// discount is a decision the owner should make with the whole screen, not
// squeezed under the editor.
//
//   Stage 1: from when, until when. Nothing else on screen.
//   Stage 2: stage 1 slides away; pick categories/items and the percentage.

const T = {
  title: 'שעה שמחה',
  step1: 'מתי?',
  step1Hint: 'מאיזו שעה ועד איזו שעה ההנחה פעילה. סיום מוקדם מההתחלה נחשב לאחרי חצות.',
  from: 'משעה',
  to: 'עד שעה',
  overnight: 'ההנחה תמשיך אחרי חצות',
  next: 'המשך',
  step2: 'על מה ההנחה?',
  step2Hint: 'בחר/י קטגוריה שלמה או פריטים בודדים, וקבע/י כמה אחוזי הנחה.',
  percent: 'אחוז הנחה',
  wholeCat: 'כל הקטגוריה',
  save: 'שמירה והפעלה',
  saveOff: 'שמירה (כבוי)',
  saving: 'שומר…',
  cancel: 'ביטול',
  back: 'חזרה',
  enabled: 'הפעלה עכשיו',
  none: 'לא נבחר כלום — בחר/י לפחות קטגוריה או פריט אחד.',
  selected: (n: number) => `${n} נבחרו`,
  window: (a: string, b: string) => `${a} – ${b}`,
}

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

export default function HappyHourWizard({
  categories, initial, onClose, onSaved,
}: {
  categories: MenuCategory[]
  initial: HappyHour
  onClose: () => void
  onSaved: (hh: HappyHour) => void | Promise<void>
}) {
  const [stage, setStage] = useState<1 | 2>(1)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [enabled, setEnabled] = useState(initial.enabled)
  const [rules, setRules] = useState<Map<string, HappyHourRule>>(
    () => new Map(initial.rules.map((r) => [`${r.scope}:${r.id}`, r])),
  )
  const [percent, setPercent] = useState(initial.rules[0]?.percent ?? 20)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, saving])

  const overnight = useMemo(() => end <= start, [start, end])

  function toggle(scope: 'category' | 'item', id: string) {
    setRules((prev) => {
      const next = new Map(prev)
      const key = `${scope}:${id}`
      if (next.has(key)) next.delete(key)
      else next.set(key, { scope, id, percent })
      return next
    })
  }

  /** Changing the percentage restyles everything already picked — the owner
   *  thinks in one discount, not per-row arithmetic. */
  function applyPercent(p: number) {
    setPercent(p)
    setRules((prev) => {
      const next = new Map<string, HappyHourRule>()
      prev.forEach((r, k) => next.set(k, { ...r, percent: p }))
      return next
    })
  }

  async function save(activate: boolean) {
    if (activate && rules.size === 0) { setErr(T.none); return }
    setSaving(true); setErr(null)
    const value: HappyHour = { enabled: activate, start, end, rules: Array.from(rules.values()) }
    try {
      const res = await fetch('/api/owner/happy-hour', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ happyHour: value }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      await onSaved(j.happyHour as HappyHour)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      animation: 'fade-in .25s var(--ease)',
    }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <header style={{
        flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 12,
        padding: 'calc(env(safe-area-inset-top) + 16px) 18px 12px', position: 'relative',
      }}>
        <span style={{ fontSize: '1.35rem' }} aria-hidden>🍹</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)' }}>{T.title}</h1>
          {stage === 2 && (
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--neon-soft)', fontWeight: 600 }}>
              {T.window(start, end)}{overnight ? ' ⌛' : ''}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label={T.cancel} className="press"
          style={{
            width: 34, height: 34, borderRadius: 999, display: 'grid', placeItems: 'center',
            border: '1px solid var(--line)', background: 'var(--bg-elev)',
            color: 'var(--text-dim)', cursor: 'pointer', flex: '0 0 auto',
          }}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor"
            strokeWidth={2.4} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 18px', position: 'relative' }}>
        {stage === 1 ? (
          // Stage 1 slides out to the start edge as stage 2 arrives.
          <section style={{ animation: 'rise-in .4s var(--ease)', paddingTop: 12, maxWidth: 460, margin: '0 auto' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--text)' }}>{T.step1}</h2>
            <p style={{ margin: '6px 0 22px', fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {T.step1Hint}
            </p>

            <HourField label={T.from} value={start} onChange={setStart} />
            <div style={{ height: 14 }} />
            <HourField label={T.to} value={end} onChange={setEnd} />

            {overnight && (
              <p style={{
                marginTop: 14, padding: '11px 13px', borderRadius: 12,
                background: 'rgba(255,94,58,0.10)', border: '1px solid rgba(255,94,58,0.28)',
                color: 'var(--neon-soft)', fontSize: '0.82rem', fontWeight: 600,
              }}>⌛ {T.overnight}</p>
            )}
          </section>
        ) : (
          <section style={{ animation: 'rise-in .4s var(--ease)', paddingTop: 12, maxWidth: 520, margin: '0 auto' }}>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--text)' }}>{T.step2}</h2>
            <p style={{ margin: '6px 0 18px', fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              {T.step2Hint}
            </p>

            {/* Percentage first — it applies to everything picked below. */}
            <div style={{
              background: 'var(--bg-elev)', border: '1px solid var(--line)',
              borderRadius: 16, padding: 14, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>{T.percent}</span>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--neon-soft)' }} dir="ltr">{percent}%</span>
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {[10, 15, 20, 25, 30, 50].map((p) => (
                  <button key={p} type="button" onClick={() => applyPercent(p)} className="press"
                    style={{
                      flex: '1 1 auto', minWidth: 56, padding: '10px 0', borderRadius: 11,
                      border: `1px solid ${p === percent ? 'var(--neon)' : 'var(--line-strong)'}`,
                      background: p === percent ? 'rgba(255,94,58,0.16)' : 'var(--bg-elev-2)',
                      color: p === percent ? 'var(--text)' : 'var(--text-dim)',
                      font: 'inherit', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                    }} dir="ltr">{p}%</button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {categories.map((cat) => {
                const catOn = rules.has(`category:${cat.id}`)
                return (
                  <div key={cat.id} style={{
                    border: `1px solid ${catOn ? 'rgba(255,94,58,0.35)' : 'var(--line)'}`,
                    borderRadius: 14, background: 'var(--bg-elev)', overflow: 'hidden',
                    transition: 'border-color .2s var(--ease)',
                  }}>
                    <button type="button" onClick={() => toggle('category', cat.id)} className="press"
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '13px', border: 'none', background: 'transparent',
                        color: 'var(--text)', font: 'inherit', fontWeight: 700,
                        fontSize: '0.94rem', cursor: 'pointer', textAlign: 'start',
                      }}>
                      <span aria-hidden>{cat.icon ?? '🍽️'}</span>
                      <span style={{ flex: 1 }}>{loc(cat.title, 'he')}</span>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-faint)', fontWeight: 600 }}>
                        {catOn ? T.wholeCat : ''}
                      </span>
                      <Check on={catOn} />
                    </button>

                    {/* Individual items only matter when the whole category
                        isn't already discounted. */}
                    {!catOn && (
                      <div style={{ borderTop: '1px solid var(--line)' }}>
                        {(cat.items ?? []).map((item) => {
                          if (!item.uid) return null
                          const on = rules.has(`item:${item.uid}`)
                          return (
                            <button key={item.uid} type="button" onClick={() => toggle('item', item.uid!)}
                              style={{
                                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                                padding: '11px 13px', border: 'none', background: 'transparent',
                                borderTop: '1px solid rgba(255,255,255,0.03)',
                                color: on ? 'var(--text)' : 'var(--text-dim)',
                                font: 'inherit', fontSize: '0.86rem', cursor: 'pointer', textAlign: 'start',
                              }}>
                              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {loc(item, 'he')}
                              </span>
                              <Check on={on} small />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <footer style={{
        flex: '0 0 auto', padding: `12px 18px calc(env(safe-area-inset-bottom) + 14px)`,
        borderTop: '1px solid var(--line)', background: 'var(--bg-elev-2)',
        maxWidth: 520, margin: '0 auto', width: '100%',
      }}>
        {err && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: '0 0 10px' }}>{err}</p>}

        {stage === 1 ? (
          <button type="button" onClick={() => { setErr(null); setStage(2) }} className="press" style={primary}>
            {T.next}
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text-dim)', fontWeight: 600 }}>
                {rules.size ? T.selected(rules.size) : T.none}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => save(false)} disabled={saving} className="press"
                style={{ ...secondary, flex: '0 0 auto' }}>
                {T.saveOff}
              </button>
              <button type="button" onClick={() => save(true)} disabled={saving || rules.size === 0} className="press"
                style={{ ...primary, flex: 1, opacity: saving || rules.size === 0 ? 0.5 : 1 }}>
                {saving ? T.saving : T.save}
              </button>
            </div>
            <button type="button" onClick={() => setStage(1)} disabled={saving} className="press" style={ghostWide}>
              {T.back}
            </button>
          </>
        )}
      </footer>
    </div>
  )
}

/** Big, thumb-sized hour list. A native <input type="time"> would drop us back
 *  into the OS picker this app deliberately avoids. */
function HourField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8 }}>
        {label}
      </label>
      <div style={{
        display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 6,
        scrollbarWidth: 'thin', WebkitOverflowScrolling: 'touch',
      }} dir="ltr">
        {HOURS.map((h) => {
          const on = h === value
          return (
            <button key={h} type="button" onClick={() => onChange(h)} className="press"
              style={{
                flex: '0 0 auto', padding: '12px 14px', borderRadius: 12,
                border: `1px solid ${on ? 'var(--neon)' : 'var(--line-strong)'}`,
                background: on ? 'rgba(255,94,58,0.16)' : 'var(--bg-elev)',
                color: on ? 'var(--text)' : 'var(--text-dim)',
                boxShadow: on ? 'var(--glow)' : 'none',
                font: 'inherit', fontWeight: 700, fontSize: '0.92rem', cursor: 'pointer',
              }}>{h}</button>
          )
        })}
      </div>
    </div>
  )
}

function Check({ on, small = false }: { on: boolean; small?: boolean }) {
  const s = small ? 20 : 24
  return (
    <span aria-hidden style={{
      width: s, height: s, borderRadius: 999, flex: '0 0 auto',
      display: 'grid', placeItems: 'center',
      border: `1px solid ${on ? 'transparent' : 'var(--line-strong)'}`,
      background: on ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))' : 'transparent',
      transition: 'background .2s var(--ease)',
    }}>
      {on && (
        <svg viewBox="0 0 24 24" width={s * 0.6} height={s * 0.6} fill="none" stroke="#fff"
          strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5l5 5L20 6.5" />
        </svg>
      )}
    </span>
  )
}

const primary: CSSProperties = {
  width: '100%', padding: '15px 0', borderRadius: 14, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  boxShadow: 'var(--glow)', color: '#fff', fontSize: '1rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const secondary: CSSProperties = {
  padding: '15px 16px', borderRadius: 14, border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev)', color: 'var(--text-dim)', fontSize: '0.92rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const ghostWide: CSSProperties = {
  width: '100%', marginTop: 8, padding: '11px 0', borderRadius: 12,
  border: 'none', background: 'transparent', color: 'var(--text-faint)',
  fontSize: '0.88rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
}
