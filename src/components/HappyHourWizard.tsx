'use client'

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { loc, type MenuCategory } from '@/lib/menu/types'
import { type HappyHour, type HappyHourRule } from '@/lib/menu/variants'
import Switch from '@/components/Switch'
import TimeWheel from '@/components/TimeWheel'

// Full-screen, two-stage onboarding — deliberately NOT a sheet. Setting up a
// discount deserves the whole screen.
//
//   Stage 1: from when, until when. Nothing else.
//   Stage 2: stage 1 animates away; pick what's discounted and by how much.
//
// Selecting a category turns ON every item in it and expands it, so the owner
// can drop the two or three they didn't mean to include. That's why rules are
// stored per ITEM: a category rule would silently re-include anything added
// later, which is the opposite of what someone excluding items expects.

const T = {
  title: 'Happy Hour',
  step1: 'מתי?',
  step1Hint: 'מאיזו שעה ועד איזו שעה ההנחה פעילה. סיום מוקדם מההתחלה נחשב לאחרי חצות.',
  from: 'משעה',
  to: 'עד שעה',
  overnight: 'ההנחה תמשיך אחרי חצות',
  next: 'המשך',
  step2: 'על מה ההנחה?',
  step2Hint: 'בחר/י קטגוריה כדי לכלול את כל הפריטים שבה, ואז אפשר לבטל פריטים בודדים.',
  percent: 'אחוז הנחה',
  percentHint: 'לחיצה נוספת על אחוז שנבחר מבטלת אותו.',
  noPercent: 'לא נבחר אחוז',
  save: 'שמירה והפעלה',
  saveOff: 'שמירה (כבוי)',
  saving: 'שומר…',
  cancel: 'ביטול',
  back: 'חזרה',
  none: 'לא נבחר כלום — בחר/י לפחות פריט אחד.',
  needPercent: 'צריך לבחור אחוז הנחה.',
  selected: (n: number) => `${n} פריטים בהנחה`,
}

const PERCENTS = [10, 15, 20, 25, 30, 50]

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
  // Item uids currently discounted. Category selection is a bulk action over
  // these, never a stored rule of its own.
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(initial.rules.filter((r) => r.scope === 'item').map((r) => r.id)),
  )
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [percent, setPercent] = useState<number | null>(initial.rules[0]?.percent ?? null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // A stored category rule (from an earlier version of this screen) expands
  // into its items so nothing silently disappears when the owner re-saves.
  useEffect(() => {
    const catRules = initial.rules.filter((r) => r.scope === 'category')
    if (!catRules.length) return
    setPicked((prev) => {
      const next = new Set(prev)
      for (const r of catRules) {
        const cat = categories.find((c) => c.id === r.id)
        for (const i of cat?.items ?? []) if (i.uid) next.add(i.uid)
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose, saving])

  const overnight = useMemo(() => end <= start, [start, end])

  function toggleItem(uid: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid); else next.add(uid)
      return next
    })
  }

  function toggleCategory(cat: MenuCategory) {
    const uids = (cat.items ?? []).map((i) => i.uid).filter((u): u is string => !!u)
    const anyOn = uids.some((u) => picked.has(u))
    setPicked((prev) => {
      const next = new Set(prev)
      for (const u of uids) { if (anyOn) next.delete(u); else next.add(u) }
      return next
    })
    // Turning a category on opens it, so the owner can immediately drop the
    // items they didn't mean to include — that was the whole request.
    if (!anyOn) setOpen((prev) => new Set(prev).add(cat.id))
  }

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function save(activate: boolean) {
    if (activate && picked.size === 0) { setErr(T.none); return }
    if (activate && percent === null) { setErr(T.needPercent); return }

    setSaving(true); setErr(null)
    const rules: HappyHourRule[] = percent === null ? [] : Array.from(picked).map((id) => ({
      scope: 'item' as const, id, percent,
    }))
    const value: HappyHour = { enabled: activate, start, end, rules }
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
    <div className="hh-screen">
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <header className="hh-head">
        <span aria-hidden style={{ fontSize: '1.35rem' }}>🍹</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)' }}>{T.title}</h1>
          {stage === 2 && (
            <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: 'var(--neon-soft)', fontWeight: 600 }} dir="ltr">
              {start} – {end}{overnight ? ' ⌛' : ''}
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} disabled={saving} aria-label={T.cancel} className="press hh-close">
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor"
            strokeWidth={2.4} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </header>

      <div className="hh-body">
        {stage === 1 ? (
          <section className="hh-stage" style={{ animation: 'rise-in .4s var(--ease)' }}>
            <h2 className="hh-h2">{T.step1}</h2>
            <p className="hh-hint">{T.step1Hint}</p>

            {/* Side by side once there's room: "from" and "to" are one
                decision, and reading them as a pair beats scrolling between
                two stacked pickers. */}
            <div className="time-pair">
              <HourGrid label={T.from} value={start} onChange={setStart} />
              <HourGrid label={T.to} value={end} onChange={setEnd} />
            </div>

            {overnight && <p className="hh-note">⌛ {T.overnight}</p>}
          </section>
        ) : (
          <section className="hh-stage" style={{ animation: 'rise-in .4s var(--ease)' }}>
            <h2 className="hh-h2">{T.step2}</h2>
            <p className="hh-hint">{T.step2Hint}</p>

            {/* Percentage first — it applies to everything picked below. */}
            <div className="hh-percent-card">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text)' }}>{T.percent}</span>
                <span style={{
                  fontSize: '1.6rem', fontWeight: 800,
                  color: percent === null ? 'var(--text-faint)' : 'var(--neon-soft)',
                }} dir="ltr">
                  {percent === null ? '—' : `${percent}%`}
                </span>
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '0.74rem', color: 'var(--text-faint)' }}>{T.percentHint}</p>
              <div className="hh-percent-grid">
                {PERCENTS.map((p) => {
                  const on = p === percent
                  return (
                    <button key={p} type="button" className="press hh-percent-btn"
                      data-on={on ? 'true' : undefined}
                      // Tapping the selected one clears it — the owner asked to
                      // be able to unselect.
                      onClick={() => setPercent(on ? null : p)}
                      dir="ltr">{p}%</button>
                  )
                })}
              </div>
            </div>

            <div className="sheet-scroll" style={{ overflow: 'visible' }}>
              {categories.map((cat) => {
                const uids = (cat.items ?? []).map((i) => i.uid).filter((u): u is string => !!u)
                if (!uids.length) return null
                const onCount = uids.filter((u) => picked.has(u)).length
                const all = onCount === uids.length
                const none = onCount === 0
                const isOpen = open.has(cat.id)

                return (
                  <div key={cat.id} className="pick-cat"
                    style={none ? undefined : { borderColor: 'rgba(255,94,58,0.35)' }}>
                    <div className="pick-cat-head">
                      <button type="button" onClick={() => toggleOpen(cat.id)}
                        className="pick-expand press" aria-expanded={isOpen} aria-label={loc(cat.title, 'he')}>
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
                        style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
                        aria-label={loc(cat.title, 'he')}>
                        <Switch on={all} partial={!all && !none} />
                      </button>
                    </div>

                    {isOpen && (
                      <div className="pick-items">
                        {(cat.items ?? []).map((item) => {
                          if (!item.uid) return null
                          const on = picked.has(item.uid)
                          return (
                            <button key={item.uid} type="button" onClick={() => toggleItem(item.uid!)}
                              className="pick-item" role="switch" aria-checked={on}>
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
          </section>
        )}
      </div>

      <footer className="hh-foot">
        {err && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: '0 0 10px' }}>{err}</p>}

        {stage === 1 ? (
          <button type="button" onClick={() => { setErr(null); setStage(2) }} className="press" style={primary}>
            {T.next}
          </button>
        ) : (
          <>
            <p style={{
              margin: '0 0 10px', fontSize: '0.84rem', fontWeight: 600,
              color: picked.size ? 'var(--neon-soft)' : 'var(--text-faint)',
            }}>
              {picked.size ? T.selected(picked.size) : T.none}
              {picked.size > 0 && percent === null && ` · ${T.noPercent}`}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => save(false)} disabled={saving} className="press" style={secondary}>
                {T.saveOff}
              </button>
              <button type="button" onClick={() => save(true)}
                disabled={saving || picked.size === 0 || percent === null} className="press"
                style={{ ...primary, flex: 1, opacity: saving || picked.size === 0 || percent === null ? 0.5 : 1 }}>
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

/** Was a 24-button grid, which could only ever say "on the hour" and looked
 *  nothing like the menu timer's picker. Same clock wheel now, so every time in
 *  the owner panel is set the same way — and Happy Hour can finally start at
 *  17:30. */
function HourGrid({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8 }}>
        {label}
      </label>
      <TimeWheel value={value} onChange={onChange} />
    </div>
  )
}

const primary: CSSProperties = {
  width: '100%', padding: '15px 0', borderRadius: 14, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  boxShadow: 'var(--glow)', color: '#fff', fontSize: '1rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const secondary: CSSProperties = {
  flex: '0 0 auto', padding: '15px 16px', borderRadius: 14,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
  color: 'var(--text-dim)', fontSize: '0.92rem', fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer',
}
const ghostWide: CSSProperties = {
  width: '100%', marginTop: 8, padding: '11px 0', borderRadius: 12,
  border: 'none', background: 'transparent', color: 'var(--text-faint)',
  fontSize: '0.88rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
}
