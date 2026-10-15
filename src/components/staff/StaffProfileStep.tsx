'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { haptic } from '@/lib/haptics'
import { PROFILE_COLOURS, PROFILE_COLOUR_NAMES, PROFILE_EMOJIS, validateProfile } from '@/lib/staff/profile'

// The onboarding wizard's DETAILS step (2026-10-15) — right after the Google account is linked and before the tour.
// Owner: the new employee can "change first or last name, add a phone number and select a colour and emoji".
//
// The form opens with everything already filled: the name the owner typed, and a colour and emoji already chosen at
// random (the server hands out the least-used ones — lib/staff/profile.ts), so "דילוג" always leaves a person with an
// identity. Saving goes to PATCH /api/staff/me/profile, which edits only the SIGNED-IN person's own row. The phone field
// is offered only when the server says the column exists (migration 062); before that the rest still saves.
//
// Stores nothing on the device. Every control is a real button/input, and the colour swatches are labelled by NAME, not
// by colour alone.

interface Loaded { firstName: string; lastName: string; colour: string | null; initial: string | null; phone: string; phoneReady: boolean }

export default function StaffProfileStep({ onDone }: { onDone: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')
  const [colour, setColour] = useState<string>(PROFILE_COLOURS[0]!)
  const [initial, setInitial] = useState<string>(PROFILE_EMOJIS[0]!)
  const [busy, setBusy] = useState<'save' | 'skip' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/staff/me/profile')
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Loaded> })
      .then((d) => {
        if (!alive) return
        setLoaded(d); setFirst(d.firstName); setLast(d.lastName); setPhone(d.phone)
        if (d.colour && PROFILE_COLOURS.includes(d.colour)) setColour(d.colour)
        if (d.initial && PROFILE_EMOJIS.includes(d.initial)) setInitial(d.initial)
      })
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
  }, [])
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])

  async function save(kind: 'save' | 'skip') {
    if (busy) return
    setError(null)
    // "Skip" keeps the name and the chosen colour and emoji and sends no phone — it never blocks on a form.
    const input = kind === 'skip'
      ? { firstName: loaded?.firstName ?? first, lastName: loaded?.lastName ?? last, colour, initial }
      : { firstName: first, lastName: last, colour, initial, ...(loaded?.phoneReady ? { phone } : {}) }
    const checked = validateProfile(input)
    if (!checked.ok) { setError(checked.message); return }
    setBusy(kind)
    try {
      const res = await fetch('/api/staff/me/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) { setError(json.error ?? 'השמירה נכשלה. נסו שוב.'); return }
      haptic('impact')
      onDone()
    } catch {
      setError('אין חיבור. נסו שוב.')
    } finally {
      setBusy(null)
    }
  }

  if (loadFailed) {
    // The details are a nicety, never a gate: if they cannot be loaded the person goes on to the tour.
    return (
      <section className="rise" style={sectionStyle} aria-labelledby="profile-h">
        <h1 id="profile-h" ref={headingRef} tabIndex={-1} style={h1Style}>החשבון חובר ✅</h1>
        <p style={leadStyle}>לא הצלחנו לטעון את הפרטים כרגע. אפשר להשלים אותם אחר כך — ממשיכים לסיור.</p>
        <button type="button" className="press" style={primaryBtn} onClick={onDone}>המשך</button>
      </section>
    )
  }
  if (!loaded) {
    return <section className="rise" style={sectionStyle} aria-busy="true"><p style={leadStyle}>טוען…</p></section>
  }

  return (
    <section className="rise" style={sectionStyle} aria-labelledby="profile-h">
      <p style={kickerStyle}>החשבון חובר ✅</p>
      <h1 id="profile-h" ref={headingRef} tabIndex={-1} style={h1Style}>הפרטים שלי</h1>
      <p style={leadStyle}>כך יכירו אתכם בצוות. אפשר לשנות כל דבר, ואפשר גם לדלג — הכול ניתן לעדכון אחר כך.</p>

      {/* the live preview: the mark that will appear next to the name */}
      <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
        <span style={{
          width: 56, height: 56, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: '1.7rem',
          background: `${colour}33`, border: `2px solid ${colour}`,
        }}>{initial}</span>
        <span style={{ fontWeight: 800, color: 'var(--text)', fontSize: '1.05rem' }}>{[first, last].filter(Boolean).join(' ') || '—'}</span>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={labelStyle}>שם פרטי</span>
          <input style={inputStyle} value={first} maxLength={40} autoComplete="given-name" onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label style={{ flex: 1, minWidth: 0 }}>
          <span style={labelStyle}>שם משפחה</span>
          <input style={inputStyle} value={last} maxLength={40} autoComplete="family-name" onChange={(e) => setLast(e.target.value)} />
        </label>
      </div>

      {loaded.phoneReady && (
        <label>
          <span style={labelStyle}>טלפון (לא חובה)</span>
          <input
            style={{ ...inputStyle, direction: 'ltr', textAlign: 'start' }} value={phone} inputMode="tel" autoComplete="tel"
            placeholder="050-1234567" maxLength={20} onChange={(e) => setPhone(e.target.value)}
          />
          <span style={hintStyle}>רק ההנהלה רואה את המספר.</span>
        </label>
      )}

      <fieldset style={fieldsetStyle}>
        <legend style={labelStyle}>צבע</legend>
        <div role="radiogroup" aria-label="צבע" style={gridStyle}>
          {PROFILE_COLOURS.map((c, i) => (
            <button
              key={c} type="button" role="radio" aria-checked={colour === c} aria-label={PROFILE_COLOUR_NAMES[i]}
              className="press" onClick={() => { haptic('select'); setColour(c) }}
              style={{
                minHeight: 40, borderRadius: 12, cursor: 'pointer', background: c,
                border: colour === c ? '3px solid var(--text)' : '3px solid transparent',
                outline: colour === c ? `2px solid ${c}` : 'none',
              }}
            />
          ))}
        </div>
      </fieldset>

      <fieldset style={fieldsetStyle}>
        <legend style={labelStyle}>אימוג׳י</legend>
        <div role="radiogroup" aria-label="אימוג׳י" style={gridStyle}>
          {PROFILE_EMOJIS.map((e) => (
            <button
              key={e} type="button" role="radio" aria-checked={initial === e} aria-label={e}
              className="press" onClick={() => { haptic('select'); setInitial(e) }}
              style={{
                minHeight: 44, borderRadius: 12, cursor: 'pointer', fontSize: '1.35rem',
                background: initial === e ? `${colour}33` : 'var(--bg)',
                border: initial === e ? `2px solid ${colour}` : '1px solid var(--line-strong)',
              }}
            >{e}</button>
          ))}
        </div>
      </fieldset>

      {error && <p role="alert" style={errorStyle}>{error}</p>}
      <button type="button" className="press" style={primaryBtn} disabled={!!busy} onClick={() => save('save')}>
        {busy === 'save' ? 'שומר…' : 'שמירה והמשך'}
      </button>
      <button type="button" className="press" style={linkBtn} disabled={!!busy} onClick={() => save('skip')}>
        {busy === 'skip' ? 'ממשיך…' : 'דילוג — אשלים אחר כך'}
      </button>
    </section>
  )
}

const sectionStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'start' }
const kickerStyle: CSSProperties = { margin: 0, textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'var(--neon-soft)' }
const h1Style: CSSProperties = { margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--text)', textAlign: 'center', outline: 'none' }
const leadStyle: CSSProperties = { margin: 0, fontSize: '0.9rem', color: 'var(--text-dim)', lineHeight: 1.65, textAlign: 'center' }
const labelStyle: CSSProperties = { display: 'block', marginBottom: 6, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)', padding: 0 }
const hintStyle: CSSProperties = { display: 'block', marginTop: 4, fontSize: '0.72rem', color: 'var(--text-faint)' }
const inputStyle: CSSProperties = {
  width: '100%', minHeight: 46, padding: '10px 12px', borderRadius: 11, border: '1px solid var(--line-strong)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: '1rem', fontFamily: 'inherit', boxSizing: 'border-box',
}
const fieldsetStyle: CSSProperties = { border: 0, margin: 0, padding: 0, minWidth: 0 }
const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 8 }
const errorStyle: CSSProperties = { margin: 0, fontSize: '0.86rem', fontWeight: 600, color: '#ff6b6b', lineHeight: 1.5, textAlign: 'center' }
const primaryBtn: CSSProperties = {
  minHeight: 48, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)',
  color: 'var(--bg)', fontSize: '1rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const linkBtn: CSSProperties = {
  alignSelf: 'center', minHeight: 44, padding: '8px 16px', background: 'none', border: 0, color: 'var(--text-faint)',
  fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer',
}
