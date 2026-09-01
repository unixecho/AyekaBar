'use client'

import { useCallback, useEffect, useState } from 'react'

// The cart's on/off switch, in the menu editor — the menu's control room, next
// to Happy Hour and the version bar, because "does the menu offer a cart" is a
// menu decision and the people trusted with the menu (OP + general manager)
// are exactly the people who should be able to make it.
//
// WHY THERE IS A SWITCH AT ALL. The cart is entirely client-side and sends
// nothing anywhere, so it is not a risk that needs containing. It is a
// CUSTOMER-FACING change to the bar's most-used screen, and every one of those
// in this app has an off switch the owner can reach without a deploy — the
// loyalty club, Happy Hour, the portal's links. A busy Saturday where the
// steppers are getting in the way should cost one tap, not a phone call.
//
// Defaults to ON (see MENU_CART_ENABLED) — the opposite of the loyalty switch,
// deliberately, and for a reason spelled out on that constant.

const T = {
  title: 'עגלת הזמנה בתפריט',
  on: 'פעילה',
  off: 'כבויה',
  label: 'הצגה ללקוחות',
  descOn: 'הלקוחות בוחרים פריטים, מחלקים ביניהם ומראים למלצר.',
  descOff: 'התפריט מוצג לקריאה בלבד, בדיוק כמו קודם.',
  hint: 'הרשימה נשמרת רק במכשיר של הלקוח ולא נשלחת לשום מקום — אין כאן איסוף מידע.',
  soonTitle: 'בקרוב',
  soonBody: 'שליחת ההזמנה למלצר וקריאה למלצר מהתפריט. הכפתורים כבר מוצגים ללקוח כ״בקרוב״ ואינם פעילים.',
  failed: 'שינוי המצב נכשל. נסה/י שוב.',
  loading: 'טוען…',
}

export default function MenuCartCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/menu-cart', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setEnabled(j.menuCartEnabled === true)
    } catch {
      // A failed read must not render a switch claiming "off" — the customer
      // side defaults to ON, and a control that lies about the live state is
      // worse than one that admits it doesn't know.
      setEnabled(null)
      setErr(T.failed)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle() {
    if (enabled === null || busy) return
    const next = !enabled
    setBusy(true); setErr(null)
    setEnabled(next) // optimistic — a switch must feel instant
    try {
      const res = await fetch('/api/owner/menu-cart', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menuCartEnabled: next }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? T.failed)
      setEnabled(j.menuCartEnabled === true)
    } catch (e) {
      setEnabled(!next) // roll back
      setErr(e instanceof Error ? e.message : T.failed)
    } finally {
      setBusy(false)
    }
  }

  const hot = enabled === true

  return (
    <div style={{
      background: 'var(--bg-elev)',
      border: `1px solid ${hot ? 'rgba(56,225,255,0.3)' : 'var(--line)'}`,
      borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
      transition: 'border-color .3s var(--ease)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: '1.25rem' }}>🧾</span>
        <span style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)', flex: 1 }}>{T.title}</span>
        <span style={{
          borderRadius: 999, padding: '2px 9px', fontSize: '0.7rem', fontWeight: 700,
          color: hot ? 'var(--neon-2)' : 'var(--text-faint)',
          background: hot ? 'rgba(56,225,255,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${hot ? 'rgba(56,225,255,0.3)' : 'var(--line-strong)'}`,
        }}>{enabled === null ? T.loading : hot ? T.on : T.off}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{T.label}</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '2px 0 0', lineHeight: 1.5 }}>
            {enabled === false ? T.descOff : T.descOn}
          </p>
        </div>

        <button
          type="button" role="switch"
          aria-checked={enabled === true}
          aria-label={T.label}
          onClick={toggle}
          disabled={busy || enabled === null}
          className="press"
          style={{
            flex: '0 0 auto', width: 52, height: 30, borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${hot ? 'transparent' : 'var(--line-strong)'}`,
            background: hot
              ? 'linear-gradient(135deg, var(--neon-2), #7defff)'
              : 'var(--bg-elev-2)',
            // ltr so the knob starts at the physical left in Hebrew too —
            // translateX is not direction-aware, the flex start would be.
            direction: 'ltr',
            padding: 3, display: 'flex', alignItems: 'center',
            opacity: busy || enabled === null ? 0.6 : 1,
            transition: 'background .3s var(--ease), opacity .2s var(--ease)',
          }}
        >
          <span aria-hidden style={{
            width: 22, height: 22, borderRadius: 999, background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
            transform: `translateX(${hot ? 22 : 0}px)`,
            transition: 'transform .28s var(--ease)',
          }} />
        </button>
      </div>

      <p style={{
        fontSize: '0.76rem', color: 'var(--text-faint)', margin: 0, lineHeight: 1.55,
        borderTop: '1px solid var(--line)', paddingTop: 10,
      }}>
        {T.hint}
        <br />
        <b style={{ color: 'var(--text-dim)' }}>{T.soonTitle}:</b> {T.soonBody}
      </p>

      {err && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0 }}>{err}</p>}
    </div>
  )
}
