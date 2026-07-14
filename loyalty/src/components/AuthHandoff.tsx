'use client'
import { useEffect, useState, type CSSProperties } from 'react'

const EASE = 'cubic-bezier(0.22,1,0.36,1)'
const SPRING = 'cubic-bezier(.34,1.56,.64,1)'
const EXIT_MS = 240

const COPY = {
  he: {
    aria: 'המשך עם Google', back: 'חזרה',
    title: 'קפיצה קצרה ל-Google',
    subtitle: 'Google מאמת שזה אתה ומחזיר אותך היישר לכאן. מה שחשוב לדעת:',
    rows: [
      ['🔒', 'רק השם והאימייל', 'זה כל מה ש-Google משתף עם אייכה בר.'],
      ['⚡', 'הקשה אחת, בלי סיסמאות', 'חשבון ה-Google שלך הוא המפתח.'],
      ['🎁', 'הנקודות שלך מאובטחות', 'הזהות מאומתת — אי אפשר לזייף נקודות.'],
    ],
    cta: 'המשך עם Google', connecting: 'מתחבר…', notNow: 'לא עכשיו',
  },
  en: {
    aria: 'Continue with Google', back: 'Back',
    title: 'A quick hop to Google',
    subtitle: 'Google confirms it’s you, then sends you straight back here. Here’s the deal:',
    rows: [
      ['🔒', 'Only your name & email', 'That’s all Google shares with Ayeka Bar.'],
      ['⚡', 'One tap, no passwords', 'Your Google account is the key.'],
      ['🎁', 'Your points are secure', 'Verified identity — points can’t be faked.'],
    ],
    cta: 'Continue with Google', connecting: 'Connecting…', notNow: 'Not now',
  },
} as const

export function AuthHandoff({
  open, busy, error, lang = 'he', onContinue, onClose,
}: {
  open: boolean; busy: boolean; error: string | null;
  lang?: 'he' | 'en'; onContinue: () => void; onClose: () => void;
}) {
  const t = COPY[lang]
  const [shown, setShown] = useState(open)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) { setShown(true); setClosing(false); return }
    setClosing(true)
    const id = setTimeout(() => { setShown(false); setClosing(false) }, EXIT_MS)
    return () => clearTimeout(id)
  }, [open])

  if (!shown) return null

  return (
    <div role="dialog" aria-modal="true" aria-label={t.aria} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'radial-gradient(ellipse 80% 40% at 85% -5%, rgba(255,94,58,0.14), transparent 60%), var(--bg)',
      color: 'var(--text)', display: 'flex', flexDirection: 'column',
      padding: 'calc(env(safe-area-inset-top) + 14px) 20px calc(env(safe-area-inset-bottom) + 28px)',
      opacity: closing ? 0 : 1, transition: `opacity ${EXIT_MS}ms ease`,
      animation: 'handoff-in .3s ease backwards', overflowY: 'auto',
    }}>
      <button aria-label={t.back} className="press dir-flip" onClick={onClose} style={{
        alignSelf: 'flex-start', width: 36, height: 36, borderRadius: 999, border: 0, cursor: 'pointer',
        background: 'var(--bg-elev-2)', color: 'var(--text-dim)', fontSize: 20, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: `rise-in .45s ${EASE} .05s backwards`,
      }}>‹</button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 300 }}>
        <div dir="ltr" style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 28 }}>
          <Tile delay={0.1}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/logo.svg" alt="" width={34} height={34} style={{ display: 'block' }} />
          </Tile>
          <div style={{ display: 'flex', gap: 7 }} aria-hidden>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--neon)', animation: `handoff-dot 1.5s ease-in-out ${i * 0.22}s infinite` }} />
            ))}
          </div>
          <Tile delay={0.22} style={{ background: '#fff', border: '1px solid rgba(255,255,255,0.9)' }}>
            <GoogleG size={26} />
          </Tile>
        </div>

        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, animation: `rise-in .5s ${EASE} .18s backwards` }}>{t.title}</h1>
        <p style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-dim)', lineHeight: 1.45, margin: '10px 0 0', maxWidth: 300, animation: `rise-in .5s ${EASE} .26s backwards` }}>{t.subtitle}</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 26, width: '100%', maxWidth: 360 }}>
          {t.rows.map(([icon, title, blurb], i) => (
            <div key={title} style={{
              display: 'flex', alignItems: 'center', gap: 13, textAlign: 'start',
              background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px',
              animation: `rise-in .5s ${EASE} ${0.34 + i * 0.09}s backwards`,
            }}>
              <span style={{ fontSize: 20 }} aria-hidden>{icon}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-dim)', marginTop: 1, lineHeight: 1.4 }}>{blurb}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, animation: `rise-in .5s ${EASE} .55s backwards` }}>
        {error && <div style={{ fontSize: 13, fontWeight: 500, color: '#ff6b6b', textAlign: 'center' }}>{error}</div>}
        <button onClick={onContinue} disabled={busy} className="press" style={{
          width: '100%', borderRadius: 12, padding: 15, fontSize: 15, fontWeight: 700, border: 0,
          fontFamily: 'inherit', background: '#fff', color: '#1a1c1e', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: busy ? 0.7 : 1,
        }}>
          {busy ? (
            <><span aria-hidden style={{ width: 16, height: 16, borderRadius: 999, border: '2.5px solid rgba(26,28,30,0.25)', borderTopColor: '#1a1c1e', animation: 'ah-spin .7s linear infinite' }} />{t.connecting}</>
          ) : (
            <><GoogleG size={18} />{t.cta}</>
          )}
        </button>
        <button onClick={onClose} disabled={busy} className="press" style={{ padding: 8, fontSize: 14, fontWeight: 600, color: 'var(--text-dim)', background: 'none', border: 0, cursor: 'pointer', fontFamily: 'inherit' }}>{t.notNow}</button>
      </div>
    </div>
  )
}

function Tile({ children, delay, style }: { children: React.ReactNode; delay: number; style?: CSSProperties }) {
  return (
    <div style={{
      width: 64, height: 64, borderRadius: 18,
      background: 'rgba(255,94,58,0.14)', border: '1px solid rgba(255,94,58,0.28)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: `handoff-pop .55s ${SPRING} ${delay}s backwards`, ...style,
    }}>{children}</div>
  )
}

export function GoogleG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}
