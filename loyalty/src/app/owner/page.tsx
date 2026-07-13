'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { AuthHandoff, GoogleG } from '@/components/AuthHandoff'

// Owner sign-in. Google-gated; /owner/dashboard requires role = 'owner'.
const COPY = {
  he: {
    tagline: 'ניהול — בעל/ת העסק',
    google: 'המשך עם Google',
    hint: 'אזור ניהול. גישה לבעלי הרשאת בעלים בלבד.',
    googleError: 'שגיאה בהתחברות ל-Google.',
    denied: 'לחשבון הזה אין הרשאת בעלים.',
    back: '← חזרה',
  },
} as const
const t = COPY.he

export default function OwnerSignInPage() {
  const [error, setError]       = useState<string | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('denied')) {
      setError(t.denied)
      window.history.replaceState(null, '', window.location.pathname)
    } else if (params.get('error') === 'auth') {
      setError(t.googleError)
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  async function startGoogle() {
    setAuthBusy(true); setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/owner/dashboard` },
    })
    if (error) { setAuthBusy(false); setError(t.googleError) }
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={brandStyle}>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</h1>
          <p style={{ color: 'var(--text-dim)', margin: '4px 0 0', fontSize: '0.9rem' }}>{t.tagline}</p>
        </div>

        <button onClick={() => setAuthOpen(true)} className="press" style={googleBtnStyle}>
          <GoogleG size={18} />{t.google}
        </button>
        {error && !authOpen && (
          <p style={{ color: '#ff6b6b', fontSize: '0.85rem', margin: 0, textAlign: 'center', lineHeight: 1.5 }}>{error}</p>
        )}

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
  minHeight: '100dvh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: '24px 20px',
}
const cardStyle: React.CSSProperties = {
  width: '100%', maxWidth: 360,
  background: 'var(--bg-elev)', border: '1px solid var(--line)',
  borderRadius: 20, padding: '32px 24px',
  display: 'flex', flexDirection: 'column', gap: 20,
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
