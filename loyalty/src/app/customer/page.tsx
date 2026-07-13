'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { AuthHandoff, GoogleG } from '@/components/AuthHandoff'

// Customers sign in with Google only — no email/password self-signup.
// New user-facing strings live in he + en (app renders Hebrew today).
const COPY = {
  he: {
    tagline: 'הצטרף למועדון הנאמנות',
    google: 'המשך עם Google',
    hint: 'כניסה מהירה ומאובטחת עם חשבון Google — בלי סיסמאות.',
    googleError: 'שגיאה בהתחברות ל-Google.',
    googleReturnError: 'ההתחברות ל-Google לא הושלמה. נסה שוב.',
    back: '← חזרה',
  },
  en: {
    tagline: 'Join the loyalty club',
    google: 'Continue with Google',
    hint: 'Fast, secure sign-in with your Google account — no passwords.',
    googleError: 'Google sign-in failed.',
    googleReturnError: 'Google sign-in didn’t complete. Please try again.',
    back: '← Back',
  },
} as const
const t = COPY.he

export default function CustomerSignInPage() {
  const [error, setError]       = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const supabase = createClient()

  // Surface a failed OAuth round-trip (/auth/callback redirects here with ?error=auth)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error') === 'auth') {
      setError(t.googleReturnError)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  async function startGoogle() {
    setAuthBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/customer/dashboard` },
    })
    if (error) { setAuthBusy(false); setError(t.googleError) }
    // success → browser redirects to Google
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={brandStyle}>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</h1>
          <p style={{ color: 'var(--text-dim)', margin: '4px 0 0', fontSize: '0.95rem' }}>{t.tagline}</p>
        </div>

        {/* Google is the only way in for customers (white button + 4-color G per Google branding) */}
        <button onClick={() => setAuthOpen(true)} className="press" style={googleBtnStyle}>
          <GoogleG size={18} />{t.google}
        </button>
        {error && !authOpen && <p style={{ color: '#ff5e5e', fontSize: '0.85rem', margin: 0, textAlign: 'center' }}>{error}</p>}

        <p style={{ color: 'var(--text-faint)', fontSize: '0.8rem', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
          {t.hint}
        </p>

        <Link href="/" style={{ color: 'var(--text-faint)', fontSize: '0.82rem', textAlign: 'center', textDecoration: 'none' }}>
          {t.back}
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
  minHeight: '100dvh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 20px',
}
const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  background: 'var(--bg-elev)',
  border: '1px solid var(--line)',
  borderRadius: 20,
  padding: '32px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
}
const brandStyle: React.CSSProperties = {
  fontSize: '1.8rem',
  fontWeight: 800,
  color: 'var(--text)',
  textShadow: '0 0 18px rgba(255,94,58,0.5)',
  margin: 0,
}
const googleBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px 0',
  borderRadius: 12,
  border: 'none',
  background: '#fff',
  color: '#1a1c1e',
  fontSize: '1rem',
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
}
