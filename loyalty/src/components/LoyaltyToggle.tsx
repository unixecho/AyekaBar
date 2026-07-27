'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const T = {
  title: 'מועדון הנאמנות',
  on: 'פעיל — הלקוחות רואים ונרשמים',
  off: 'בקרוב — הכפתור בפורטל מסומן "בקרוב"',
  hint: 'כשהמועדון כבוי, הברקודים ממשיכים להוביל לפורטל והתפריט עובד כרגיל. הכניסה ללקוחות ולצוות חסומה, ואזור הניהול נשאר פתוח לך.',
  saving: 'שומר…',
  failed: 'שינוי המצב נכשל. נסה/י שוב.',
  live: 'פעיל',
  soon: 'בקרוב',
}

export default function LoyaltyToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function toggle() {
    const next = !enabled
    setBusy(true); setError(null)
    setEnabled(next) // optimistic — the switch should feel instant
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loyaltyEnabled: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.failed)
      setEnabled(json.loyaltyEnabled)
      router.refresh()
    } catch (err) {
      setEnabled(!next) // roll back
      setError(err instanceof Error ? err.message : T.failed)
    } finally {
      setBusy(false)
    }
  }

  const accent = enabled ? 'var(--neon)' : 'var(--line-strong)'

  return (
    <div className="rise" style={{
      background: 'var(--bg-elev)',
      border: `1px solid ${enabled ? 'rgba(255,94,58,0.35)' : 'var(--line)'}`,
      borderRadius: 16, padding: '16px', display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'border-color .3s var(--ease)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span aria-hidden style={{ fontSize: '1.3rem' }}>{enabled ? '💳' : '⏳'}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</span>
            <span style={{
              borderRadius: 999, padding: '2px 9px', fontSize: '0.7rem', fontWeight: 700,
              color: enabled ? 'var(--neon-soft)' : 'var(--text-faint)',
              background: enabled ? 'rgba(255,94,58,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${enabled ? 'rgba(255,94,58,0.3)' : 'var(--line-strong)'}`,
            }}>{enabled ? T.live : T.soon}</span>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: '3px 0 0', lineHeight: 1.5 }}>
            {enabled ? T.on : T.off}
          </p>
        </div>

        {/* Switch */}
        <button
          type="button" role="switch" aria-checked={enabled} aria-label={T.title}
          onClick={toggle} disabled={busy} className="press"
          style={{
            flex: '0 0 auto', width: 52, height: 30, borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${enabled ? 'transparent' : 'var(--line-strong)'}`,
            background: enabled
              ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
              : 'var(--bg-elev-2)',
            boxShadow: enabled ? 'var(--glow)' : 'none',
            // ltr so the knob starts at the physical left in Hebrew too —
            // translateX is not direction-aware, the flex start would be.
            direction: 'ltr',
            padding: 3, display: 'flex', alignItems: 'center',
            opacity: busy ? 0.6 : 1,
            transition: 'background .3s var(--ease), box-shadow .3s var(--ease), opacity .2s var(--ease)',
          }}
        >
          {/* knob moves to the physical right when on, in RTL and LTR alike */}
          <span aria-hidden style={{
            width: 22, height: 22, borderRadius: 999, background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
            transform: `translateX(${enabled ? 22 : 0}px)`,
            transition: 'transform .28s var(--ease)',
          }} />
        </button>
      </div>

      <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.55, borderTop: `1px solid ${accent === 'var(--neon)' ? 'rgba(255,94,58,0.15)' : 'var(--line)'}`, paddingTop: 10 }}>
        {T.hint}
      </p>

      {error && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0 }}>{error}</p>}
    </div>
  )
}
