'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Two independent switches, because "is the club running" and "does the portal
// advertise it" are different decisions:
//   visible + enabled  -> live button on the portal
//   visible + disabled -> "בקרוב" teaser (the announcement)
//   hidden             -> no loyalty button on the portal at all
// Hiding is portal-only on purpose — /loyalty still obeys the access switch,
// so a hidden-but-enabled club stays reachable by direct link or QR.

const T = {
  title: 'מועדון הנאמנות',
  live: 'פעיל',
  soon: 'בקרוב',
  hidden: 'מוסתר',

  accessLabel: 'גישה למועדון',
  accessOn: 'הלקוחות נרשמים וצוברים נקודות',
  accessOff: 'הכניסה ללקוחות ולצוות חסומה',

  visibleLabel: 'הצגה בדף הבית',
  visibleOn: 'הכפתור מופיע בפורטל',
  visibleOff: 'הכפתור מוסתר לגמרי מהפורטל',

  hintLive: 'המועדון פעיל ומוצג בדף הבית.',
  hintSoon: 'הכפתור בדף הבית מסומן "בקרוב" — כך מכריזים על המועדון לפני הפתיחה.',
  hintHiddenOn: 'המועדון פעיל אך מוסתר מדף הבית — נגיש רק דרך קישור ישיר או ברקוד.',
  hintHiddenOff: 'המועדון כבוי ומוסתר לגמרי. הלקוחות לא רואים אותו בכלל.',
  hintAlways: 'בכל מצב: הברקודים ממשיכים להוביל לפורטל, התפריט עובד כרגיל, ואזור הניהול נשאר פתוח לך.',

  failed: 'שינוי המצב נכשל. נסה/י שוב.',
}

export default function LoyaltyToggle({
  initialEnabled,
  initialVisible = true,
}: {
  initialEnabled: boolean
  initialVisible?: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [visible, setVisible] = useState(initialVisible)
  const [busy, setBusy] = useState<'enabled' | 'visible' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function save(
    field: 'enabled' | 'visible',
    next: boolean,
    apply: (v: boolean) => void,
  ) {
    setBusy(field); setError(null)
    apply(next) // optimistic — the switch should feel instant
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          field === 'enabled' ? { loyaltyEnabled: next } : { loyaltyVisible: next }
        ),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.failed)
      apply(field === 'enabled' ? json.loyaltyEnabled : json.loyaltyVisible)
      router.refresh()
    } catch (err) {
      apply(!next) // roll back
      setError(err instanceof Error ? err.message : T.failed)
    } finally {
      setBusy(null)
    }
  }

  const status = !visible ? 'hidden' : enabled ? 'live' : 'soon'
  const statusText = status === 'hidden' ? T.hidden : status === 'live' ? T.live : T.soon
  const hint =
    status === 'live' ? T.hintLive
      : status === 'soon' ? T.hintSoon
        : enabled ? T.hintHiddenOn : T.hintHiddenOff

  // Only a live club gets the neon treatment — a hidden one should read as
  // switched off at a glance, even while access is still on.
  const hot = status === 'live'

  return (
    <div className="rise" style={{
      background: 'var(--bg-elev)',
      border: `1px solid ${hot ? 'rgba(255,94,58,0.35)' : 'var(--line)'}`,
      borderRadius: 16, padding: '16px', display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'border-color .3s var(--ease)',
    }}>
      {/* Title + combined status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: '1.3rem' }}>
          {status === 'hidden' ? '🙈' : status === 'live' ? '💳' : '⏳'}
        </span>
        <span style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</span>
        <span style={{
          borderRadius: 999, padding: '2px 9px', fontSize: '0.7rem', fontWeight: 700,
          color: hot ? 'var(--neon-soft)' : 'var(--text-faint)',
          background: hot ? 'rgba(255,94,58,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${hot ? 'rgba(255,94,58,0.3)' : 'var(--line-strong)'}`,
        }}>{statusText}</span>
      </div>

      <Row
        label={T.accessLabel}
        description={enabled ? T.accessOn : T.accessOff}
        checked={enabled}
        busy={busy === 'enabled'}
        onToggle={() => save('enabled', !enabled, setEnabled)}
      />

      <Row
        label={T.visibleLabel}
        description={visible ? T.visibleOn : T.visibleOff}
        checked={visible}
        busy={busy === 'visible'}
        onToggle={() => save('visible', !visible, setVisible)}
      />

      <p style={{
        fontSize: '0.76rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.55,
        borderTop: `1px solid ${hot ? 'rgba(255,94,58,0.15)' : 'var(--line)'}`, paddingTop: 10,
      }}>
        {hint}<br />{T.hintAlways}
      </p>

      {error && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0 }}>{error}</p>}
    </div>
  )
}

function Row({ label, description, checked, busy, onToggle }: {
  label: string; description: string; checked: boolean; busy: boolean; onToggle: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '2px 0 0', lineHeight: 1.5 }}>
          {description}
        </p>
      </div>

      <button
        type="button" role="switch" aria-checked={checked} aria-label={label}
        onClick={onToggle} disabled={busy} className="press"
        style={{
          flex: '0 0 auto', width: 52, height: 30, borderRadius: 999, cursor: 'pointer',
          // WCAG 1.4.11: was var(--line-strong) for the OFF-state track border.
          border: `1px solid ${checked ? 'transparent' : 'var(--line-interactive)'}`,
          background: checked
            ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
            : 'var(--bg-elev-2)',
          boxShadow: checked ? 'var(--glow)' : 'none',
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
          // WCAG 1.4.11: same fix as Switch.tsx/MenuCartCard.tsx — a solid
          // dark ring gives the knob real contrast against the ON-state
          // gradient (≈8.5:1 vs. white's own 2.3-3.0:1).
          border: '2px solid var(--bg)', boxSizing: 'border-box',
          boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
          transform: `translateX(${checked ? 22 : 0}px)`,
          transition: 'transform .28s var(--ease)',
        }} />
      </button>
    </div>
  )
}
