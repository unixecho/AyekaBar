'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// The single door. /owner, /staff and /customer all funnel here, and
// /auth/callback decides where you land from your access level — so nobody
// has to know which URL matches their job, and nobody can pick the wrong one.

const T = {
  title: 'כניסה',
  subtitle: 'התחבר/י עם חשבון Google כדי להמשיך. המערכת תיקח אותך לאזור המתאים לך אוטומטית.',
  google: 'המשך עם Google',
  busy: 'מתחבר…',
  error: 'ההתחברות נכשלה. נסה/י שוב.',
  returnError: 'ההתחברות בוטלה או שפג תוקפה. נסה/י שוב.',
  back: '← חזרה',
  note: 'הגישה לאזורי הניהול והצוות ניתנת על ידי בעל/ת העסק.',
}

export default function LoginPage() {
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // Supabase bounces OAuth failures back with these — including the
    // "cancelled the Google prompt" case, which must read as recoverable
    // rather than as something being broken.
    if (params.get('error') || params.get('error_code')) {
      setError(T.returnError)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  async function startGoogle() {
    setBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Force the account chooser: without it Google silently reuses
        // whichever account the browser is already in.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) { setBusy(false); setError(T.error) }
    // success → the browser leaves for Google
  }

  return (
    <main style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px)',
      position: 'relative',
    }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/logo.svg" alt="" width={72} height={72}
          style={{
            display: 'block', margin: '0 auto 14px',
            filter: 'drop-shadow(0 0 20px rgba(255,94,58,0.45))',
            animation: 'rise-in .6s var(--ease) .05s backwards',
          }}
        />
        <h1 style={{
          fontSize: '2rem', fontWeight: 800, margin: 0, color: 'var(--text)',
          textShadow: '0 0 24px rgba(255,94,58,0.55)',
          animation: 'rise-in .6s var(--ease) .12s backwards',
        }}>{T.title}</h1>
        <p style={{
          color: 'var(--text-dim)', margin: '10px 0 26px', fontSize: '0.92rem', lineHeight: 1.6,
          animation: 'rise-in .6s var(--ease) .2s backwards',
        }}>{T.subtitle}</p>

        {error && (
          <p style={{
            color: '#ff6b6b', fontSize: '0.85rem', margin: '0 0 16px', lineHeight: 1.5,
            padding: '11px 13px', borderRadius: 12,
            border: '1px solid rgba(255,107,107,0.3)', background: 'rgba(255,107,107,0.08)',
          }}>{error}</p>
        )}

        <button
          onClick={startGoogle} disabled={busy} className="press"
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '15px 18px', borderRadius: 15, border: 'none',
            background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
            boxShadow: 'var(--glow)', color: '#fff', fontSize: '1rem', fontWeight: 700,
            fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.65 : 1,
            animation: 'rise-in .6s var(--ease) .28s backwards',
          }}
        >
          <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
            <path fill="#fff" d="M21.6 12.2c0-.7-.06-1.2-.18-1.8H12v3.3h5.5c-.1.9-.7 2.3-2 3.2l-.02.12 2.9 2.24.2.02c1.85-1.7 2.92-4.2 2.92-7.1z" />
            <path fill="#fff" d="M12 21.6c2.64 0 4.86-.87 6.48-2.36l-3.09-2.4c-.83.57-1.94.97-3.39.97-2.59 0-4.79-1.7-5.57-4.06l-.11.01-3.02 2.33-.04.11C4.87 19.2 8.17 21.6 12 21.6z" />
            <path fill="#fff" d="M6.43 13.75a5.9 5.9 0 0 1 0-3.5l-.005-.12-3.06-2.37-.1.05a9.6 9.6 0 0 0 0 8.44l3.165-2.5z" />
            <path fill="#fff" d="M12 6.19c1.84 0 3.08.79 3.79 1.46l2.77-2.7C16.85 3.34 14.64 2.4 12 2.4 8.17 2.4 4.87 4.8 3.27 8.26l3.15 2.49C7.21 8.39 9.41 6.19 12 6.19z" />
          </svg>
          {busy ? T.busy : T.google}
        </button>

        <p style={{
          color: 'var(--text-faint)', fontSize: '0.78rem', margin: '16px 0 0', lineHeight: 1.6,
          animation: 'rise-in .6s var(--ease) .34s backwards',
        }}>{T.note}</p>

        <Link href="/" className="press" style={{
          display: 'inline-block', marginTop: 24, padding: '11px 18px', borderRadius: 13,
          border: '1px solid var(--line)', background: 'var(--bg-elev)',
          color: 'var(--text-dim)', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem',
          animation: 'rise-in .6s var(--ease) .4s backwards',
        }}>{T.back}</Link>
      </div>
    </main>
  )
}
