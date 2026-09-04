'use client'

import { useState } from 'react'
import type { PortalLinkKey } from '@/lib/settings/keys'

const FIELDS: { key: PortalLinkKey; label: string; emoji: string }[] = [
  { key: 'instagram', label: 'אינסטגרם', emoji: '📷' },
  { key: 'facebook', label: 'פייסבוק', emoji: '👍' },
  { key: 'review', label: 'ביקורת גוגל', emoji: '⭐' },
  { key: 'gmaps', label: 'Google Maps', emoji: '🗺️' },
  { key: 'waze', label: 'Waze', emoji: '🚗' },
  { key: 'amaps', label: 'Apple Maps', emoji: '📍' },
]

const T = {
  title: 'קישורי הפורטל',
  subtitle: 'לאן מובילים כפתורי הניווט, הרשתות החברתיות והביקורת בעמוד הראשי.',
  save: 'שמירה',
  saving: 'שומר…',
  saved: 'נשמר',
  failed: 'שמירה נכשלה. בדוק/י שהקישורים תקינים (חייבים להתחיל ב-https://).',
}

export default function PortalLinksEditor({ initialLinks }: { initialLinks: Record<PortalLinkKey, string> }) {
  const [values, setValues] = useState(initialLinks)
  const [saved, setSaved] = useState(initialLinks)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const dirty = FIELDS.some((f) => values[f.key] !== saved[f.key])

  async function save() {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalLinks: values }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.failed)
      setValues(json.portalLinks)
      setSaved(json.portalLinks)
      setNotice({ kind: 'ok', text: T.saved })
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : T.failed })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={cardStyle}>
      <div>
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>{T.title}</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.5 }}>{T.subtitle}</p>
      </div>

      {FIELDS.map((f) => (
        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-dim)' }}>{f.emoji} {f.label}</span>
          <input
            type="url" dir="ltr" inputMode="url" value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            style={inputStyle}
          />
        </label>
      ))}

      {notice && (
        <p style={{
          color: notice.kind === 'err' ? '#ff6b6b' : 'var(--neon-soft)',
          fontSize: '0.82rem', margin: 0, lineHeight: 1.5,
        }}>{notice.text}</p>
      )}

      <button type="button" onClick={save} disabled={busy || !dirty} className="press" style={{ ...saveBtnStyle, opacity: busy || !dirty ? 0.6 : 1 }}>
        {busy ? T.saving : T.save}
      </button>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 16,
  padding: '16px', display: 'flex', flexDirection: 'column', gap: 12,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: 11,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
  color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none',
}
const saveBtnStyle: React.CSSProperties = {
  width: '100%', padding: '11px 0', borderRadius: 11, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  boxShadow: 'var(--glow)', color: 'var(--bg)', fontSize: '0.95rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
