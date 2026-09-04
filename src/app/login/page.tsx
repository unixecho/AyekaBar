'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthHandoff, GoogleG } from '@/components/AuthHandoff'

// The single door. /owner, /staff and /customer all funnel here, and
// /auth/callback decides where you land from your access level — so nobody
// has to know which URL matches their job, and nobody can pick the wrong one.
//
// Two-step reveal, not a single button straight into OAuth: tapping "המשך עם
// Google" here only opens AuthHandoff, a full-screen interstitial that spends
// a beat explaining what's about to happen (name+email only, no password,
// points can't be faked) before the real Google call fires. Leaving the app
// to a third-party sign-in page reads as more trustworthy when it says so
// first, rather than firing silently on the first tap.

const T = {
  tagline: 'כניסה',
  google: 'המשך עם Google',
  hint: 'המערכת תיקח אותך לאזור המתאים לך אוטומטית לפי ההרשאה שלך.',
  googleError: 'שגיאה בהתחברות ל-Google.',
  returnError: 'ההתחברות בוטלה או שפג תוקפה. נסה/י שוב.',
  back: '← חזרה',
}

export default function LoginPage() {
  const supabase = createClient()
  const [error, setError] = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)

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
    setAuthBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Force the account chooser: without it Google silently reuses
        // whichever account the browser is already in.
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) { setAuthBusy(false); setError(T.googleError) }
    // success → the browser leaves for Google
  }

  return (
    <main id="main" style={pageStyle}>
      <div style={cardStyle}>
        <div className="rise" style={{ textAlign: 'center', animationDelay: '40ms' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="" width={56} height={56}
            style={{ display: 'block', margin: '0 auto 10px', filter: 'drop-shadow(0 0 16px rgba(255,94,58,0.4))' }} />
          <h1 style={brandStyle}>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</h1>
          <p style={{ color: 'var(--text-dim)', margin: '4px 0 0', fontSize: '0.9rem' }}>{T.tagline}</p>
        </div>

        <button onClick={() => setAuthOpen(true)} className="press rise" style={{ ...googleBtnStyle, animationDelay: '160ms' }}>
          <GoogleG size={18} />{T.google}
        </button>
        {error && !authOpen && (
          <p style={{ color: '#ff6b6b', fontSize: '0.85rem', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>{error}</p>
        )}

        <p className="rise" style={{ color: 'var(--text-faint)', fontSize: '0.8rem', textAlign: 'center', margin: 0, lineHeight: 1.5, animationDelay: '230ms' }}>
          {T.hint}
        </p>

        <Link href="/" className="rise" style={{ color: 'var(--text-faint)', fontSize: '0.82rem', textAlign: 'center', textDecoration: 'none', animationDelay: '300ms' }}>
          {T.back}
        </Link>
      </div>

      <AuthHandoff
        open={authOpen} busy={authBusy} error={error} lang="he"
        onContinue={startGoogle}
        onClose={() => { setAuthOpen(false); setError(null) }}
      />
    </main>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100dvh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: '24px 20px',
  background: 'radial-gradient(ellipse 80% 40% at 85% -5%, rgba(255,94,58,0.14), transparent 60%), var(--bg)',
}
const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 360,
  background: 'var(--bg-elev)', border: '1px solid var(--line)',
  borderRadius: 20, padding: '32px 24px',
  display: 'flex', flexDirection: 'column', gap: 20,
  animation: 'rise-in .5s var(--ease) backwards',
}
const brandStyle: React.CSSProperties = {
  fontSize: '1.8rem', fontWeight: 800, color: 'var(--text)',
  textShadow: '0 0 18px rgba(255,94,58,0.5)', margin: 0,
}
const googleBtnStyle: React.CSSProperties = {
  width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
  background: '#fff', color: '#1a1c1e', fontSize: '1rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
}
