'use client'

import { useState, type CSSProperties } from 'react'
import Switch from '@/components/Switch'
import type { SiteLanguages } from '@/lib/settings/languages'

// The owner's switches for which languages the public portal and menu offer.
//
// Each switch saves the moment it is tapped, like the menu-cart switch — there
// is no "save" button to forget, and a customer sees the change on their next
// page load. Hebrew is listed but has no switch: it is the language everything
// falls back to, so it is always on, and saying so beats leaving the owner to
// wonder where it is.

const T = {
  title: 'שפות האתר',
  subtitle: 'הלקוחות בוחרים שפה בכפתור הכדור בפורטל ובתפריט הדיגיטלי. כאן בוחרים אילו שפות מוצעות להם.',
  always: 'תמיד פעילה',
  on: 'פעילה',
  off: 'כבויה',
  summaryMany: 'הלקוחות יכולים לבחור:',
  summaryOnlyHe: 'כרגע רק עברית פעילה — כפתור בחירת השפה לא מוצג ללקוחות בכלל.',
  hint: 'כיבוי שפה רק מסתיר אותה מהלקוחות. השמות והתיאורים שכבר נכתבו בתפריט באנגלית או בערבית לא נמחקים, וחוזרים מיד כשמדליקים את השפה שוב. מי ששמר את השפה שכובתה יראה עברית.',
  failed: 'השינוי לא נשמר. נסה/י שוב.',
}

const NAMES = { he: 'עברית', en: 'English', ar: 'العربية' } as const

export default function SiteLanguagesCard({ initial }: { initial: SiteLanguages }) {
  const [langs, setLangs] = useState<SiteLanguages>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function toggle(key: 'en' | 'ar') {
    // A11y (WCAG 2.4.3): the in-flight guard lives here, not on `disabled` —
    // disabling the switch that holds keyboard focus would drop focus to <body>.
    if (busy) return
    const before = langs
    const next = { ...langs, [key]: !langs[key] }
    setBusy(true); setErr(null)
    setLangs(next) // optimistic — a switch has to feel instant
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteLanguages: next }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? T.failed)
      setLangs(j.siteLanguages)
    } catch (e) {
      setLangs(before) // roll back
      setErr(e instanceof Error ? e.message : T.failed)
    } finally {
      setBusy(false)
    }
  }

  const offered = ['he' as const, ...(langs.en ? ['en' as const] : []), ...(langs.ar ? ['ar' as const] : [])]

  return (
    <div style={card}>
      <div>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          <span aria-hidden>🌐 </span>{T.title}
        </h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.5 }}>{T.subtitle}</p>
      </div>

      <div style={row}>
        <span style={{ flex: 1, fontWeight: 700, color: 'var(--text)' }}>{NAMES.he}</span>
        <span style={pill}>{T.always}</span>
      </div>

      {(['en', 'ar'] as const).map((key) => (
        <button
          key={key} type="button" role="switch" aria-checked={langs[key]}
          aria-disabled={busy} onClick={() => toggle(key)} className="press"
          style={{ ...row, ...rowButton, opacity: busy ? 0.7 : 1 }}
        >
          <span style={{ flex: 1, fontWeight: 700, color: 'var(--text)', textAlign: 'start' }}>{NAMES[key]}</span>
          <span style={{ fontSize: '0.78rem', color: langs[key] ? 'var(--neon-soft)' : 'var(--text-faint)', fontWeight: 600 }}>
            {langs[key] ? T.on : T.off}
          </span>
          <Switch on={langs[key]} />
        </button>
      ))}

      <p aria-live="polite" style={{ fontSize: '0.84rem', color: 'var(--text-dim)', margin: 0, lineHeight: 1.55 }}>
        {offered.length === 1
          ? T.summaryOnlyHe
          : <>{T.summaryMany} <b style={{ color: 'var(--text)' }}>{offered.map((l) => NAMES[l]).join(' · ')}</b></>}
      </p>

      <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
        {T.hint}
      </p>

      {err && <p role="alert" style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0 }}>{err}</p>}
    </div>
  )
}

const card: CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 16,
  padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
}
const row: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '8px 12px',
  borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-elev-2)', fontSize: '0.95rem',
}
const rowButton: CSSProperties = { width: '100%', font: 'inherit', cursor: 'pointer', color: 'inherit' }
const pill: CSSProperties = {
  borderRadius: 999, padding: '2px 9px', fontSize: '0.7rem', fontWeight: 700,
  color: 'var(--text-dim)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line-strong)',
}
