'use client'

import { useEffect, useState } from 'react'
import { OVERALL_VIEW_URL } from '@/lib/settings/keys'

// The dashboard's entry to the Overall view — the operational birds-eye deck
// in ayeka-staff that shows the waiter, bar and kitchen screens side by side.
//
// 2026-08-27: "I want this view to be shown in the main dashboard so the
// owner or General Manager can enter this view from the dashboard, so we're
// going from demo to pre-production... leave a setting in the new portion for
// this view in the dashboard to toggle Demo on and off."
//
// ── The switch is the whole point of this card ────────────────────────
// The link alone could have been one more tile in the grid below. It gets its
// own card because it carries a switch that changes what the deck IS:
//
//   off (default) — production. The deck watches. Every write is refused
//                   inside ayeka-staff's own transport, so nothing opened
//                   here can nudge a live service.
//   on            — the three panes are fully interactive; whoever opens the
//                   deck acts as waiter, bar and cook at once, for testing
//                   alongside a real waiter on the floor.
//
// Which is exactly why the state has to be readable at a glance from the
// dashboard, not discovered after opening the deck: "demo" during real
// service is a manager's stray tap landing on someone's actual table.

const T = {
  title: 'תצוגת על',
  subtitle: 'מלצר, בר ומטבח — מבט אחד על כל המשמרת',
  open: 'פתיחת תצוגת העל',
  live: 'צפייה בלבד',
  demo: 'מצב הדגמה',

  toggleLabel: 'מצב הדגמה',
  toggleOn: 'שלושת המסכים פעילים — אפשר לשלוח, לקבל ולהגיש לצורך בדיקה',
  toggleOff: 'המסכים מציגים את המצב האמיתי בלבד ואינם משנים דבר',

  hintLive:
    'התצוגה פתוחה לבעלים, מנהל/ת כללי/ת ומנהל/ת משמרת. במצב הזה היא צופה בלבד — אי אפשר לשלוח, לקבל או להגיש ממנה, כדי לא להפריע לעבודה בפועל.',
  hintDemo:
    '⚠️ מצב הדגמה פעיל: מי שפותח/ת את התצוגה פועל/ת בו-זמנית כמלצר, ברמן וטבח על הנתונים האמיתיים. לכבות לפני משמרת אמיתית.',

  failed: 'שינוי המצב נכשל. נסה/י שוב.',
}

export default function OverallViewCard({ initialDemoMode }: { initialDemoMode: boolean }) {
  const [demo, setDemo] = useState(initialDemoMode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-seed when the server says something different.
  //
  // 2026-08-29: the dashboard's signal stack gained its own "turn demo off"
  // button, which PATCHes and then calls router.refresh(). refresh() re-runs
  // the server page and hands this component a new `initialDemoMode` — but it
  // deliberately PRESERVES client state, so `demo` stayed true and this card
  // went on insisting demo was live during service after it had been turned
  // off. Worse, the switch then read inverted: tapping it to "turn demo on"
  // computed `next = !demo` = false and re-sent OFF, so it took two taps to
  // enable and the first one appeared to do the opposite of what it said.
  //
  // Only fires when the prop actually changes, so it never fights this card's
  // own optimistic update — that path already reconciles against the server's
  // response.
  useEffect(() => { setDemo(initialDemoMode) }, [initialDemoMode])

  async function toggle() {
    const next = !demo
    setBusy(true); setError(null)
    setDemo(next) // optimistic — the switch should feel instant
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omsOverallDemoMode: next }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? T.failed)
      setDemo(json.omsOverallDemoMode)
    } catch (err) {
      setDemo(!next) // roll back
      setError(err instanceof Error ? err.message : T.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rise" style={{
      background: 'var(--bg-elev)',
      // Amber edge while demo is on — the card should look different across
      // the room, not just read differently up close.
      border: `1px solid ${demo ? 'rgba(251,191,36,0.42)' : 'var(--line)'}`,
      borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
      transition: 'border-color .3s var(--ease)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: '1.3rem' }}>{demo ? '🧪' : '👁️'}</span>
        <span style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</span>
        <span style={{
          borderRadius: 999, padding: '2px 9px', fontSize: '0.7rem', fontWeight: 700,
          color: demo ? '#FCD34D' : 'var(--text-faint)',
          background: demo ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${demo ? 'rgba(251,191,36,0.3)' : 'var(--line-strong)'}`,
        }}>{demo ? T.demo : T.live}</span>
      </div>

      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
        {T.subtitle}
      </p>

      {/* Opens in a new tab: staff.ayeka.bar is a separate app on a separate
          origin, and the deck is a full-screen surface — replacing the
          dashboard with it would strand whoever wants both. */}
      <a
        href={OVERALL_VIEW_URL} target="_blank" rel="noopener noreferrer" className="press"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          minHeight: 46, borderRadius: 12, textDecoration: 'none',
          background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
          color: '#0A0A0F', fontWeight: 700, fontSize: '0.9rem',
          boxShadow: 'var(--glow)',
        }}
      >
        {T.open} ↗
      </a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)' }}>{T.toggleLabel}</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '2px 0 0', lineHeight: 1.5 }}>
            {demo ? T.toggleOn : T.toggleOff}
          </p>
        </div>

        <button
          type="button" role="switch" aria-checked={demo} aria-label={T.toggleLabel}
          onClick={toggle} disabled={busy} className="press"
          style={{
            flex: '0 0 auto', width: 52, height: 30, borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${demo ? 'transparent' : 'var(--line-strong)'}`,
            background: demo
              ? 'linear-gradient(135deg, #FBBF24, #FCD34D)'
              : 'var(--bg-elev-2)',
            boxShadow: demo ? '0 0 18px -4px rgba(251,191,36,0.8)' : 'none',
            // ltr so the knob starts at the physical left in Hebrew too —
            // translateX is not direction-aware, the flex start would be.
            direction: 'ltr',
            padding: 3, display: 'flex', alignItems: 'center',
            opacity: busy ? 0.6 : 1,
            transition: 'background .3s var(--ease), box-shadow .3s var(--ease), opacity .2s var(--ease)',
          }}
        >
          <span aria-hidden style={{
            width: 22, height: 22, borderRadius: 999, background: '#fff',
            boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
            transform: `translateX(${demo ? 22 : 0}px)`,
            transition: 'transform .28s var(--ease)',
          }} />
        </button>
      </div>

      <p style={{
        fontSize: '0.76rem', color: demo ? '#FCD34D' : 'var(--text-faint)', margin: 0, lineHeight: 1.55,
        borderTop: `1px solid ${demo ? 'rgba(251,191,36,0.18)' : 'var(--line)'}`, paddingTop: 10,
      }}>
        {demo ? T.hintDemo : T.hintLive}
      </p>

      {error && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0 }}>{error}</p>}
    </div>
  )
}
