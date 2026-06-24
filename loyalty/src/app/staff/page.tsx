'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function StaffSignInPage() {
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode]       = useState<'magic' | 'password'>('magic')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const supabase = createClient()

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/staff/dashboard` },
    })
    if (error) { setError('שגיאה. בדוק שהמייל נכון.'); setLoading(false); return }
    setSent(true); setLoading(false)
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError('פרטים שגויים.'); setLoading(false); return }
    window.location.href = '/staff/dashboard'
  }

  if (sent) return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: '3rem', textAlign: 'center' }}>📧</div>
        <h2 style={{ color: 'var(--text)', fontWeight: 700, textAlign: 'center', margin: 0 }}>בדוק את המייל שלך</h2>
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', fontSize: '0.9rem' }}>
          שלחנו קישור ל-<strong style={{ color: 'var(--text)' }}>{email}</strong>
        </p>
      </div>
    </main>
  )

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={brandStyle}>אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר</h1>
          <p style={{ color: 'var(--text-dim)', margin: '4px 0 0', fontSize: '0.9rem' }}>כניסת צוות</p>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: 'flex',
          background: 'var(--bg-elev-2)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: 3,
          gap: 3,
        }}>
          {(['magic', 'password'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError(null) }} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: 'none',
              background: mode === m ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))' : 'transparent',
              color: mode === m ? '#fff' : 'var(--text-dim)',
              fontWeight: 600, fontSize: '0.85rem', fontFamily: 'inherit', cursor: 'pointer',
              boxShadow: mode === m ? 'var(--glow)' : 'none',
            }}>
              {m === 'magic' ? 'קישור למייל' : 'סיסמה'}
            </button>
          ))}
        </div>

        <form onSubmit={mode === 'magic' ? handleMagicLink : handlePassword}
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="staff@ayekabar.co.il" required dir="ltr" style={inputStyle} />
          {mode === 'password' && (
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="סיסמה" required style={inputStyle} />
          )}
          {error && <p style={{ color: '#ff5e5e', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
          <button type="submit" disabled={loading || !email} style={primaryBtnStyle}>
            {loading ? '...' : mode === 'magic' ? 'שלח קישור' : 'כניסה'}
          </button>
        </form>

        {mode === 'password' && (
          <p style={{ color: 'var(--text-faint)', fontSize: '0.78rem', textAlign: 'center', margin: 0 }}>
            ליצירת משתמש צוות: Supabase Dashboard → Auth → Users → Add user
          </p>
        )}

        <Link href="/" style={{ color: 'var(--text-faint)', fontSize: '0.82rem', textAlign: 'center', textDecoration: 'none' }}>
          ← חזרה
        </Link>
      </div>
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
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 12,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
  color: 'var(--text)', fontSize: '1rem', fontFamily: 'inherit', outline: 'none',
}
const primaryBtnStyle: React.CSSProperties = {
  width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  boxShadow: 'var(--glow)', color: '#fff', fontSize: '1rem',
  fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
