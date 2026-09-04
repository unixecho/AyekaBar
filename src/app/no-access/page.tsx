'use client'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'

// Where anyone signed in but not authorized lands. Reached from middleware,
// from every /owner/* page's server-side re-check, and from /auth/callback.
//
// It must NOT be gated by anything, or a denied user bounces between here and
// the page that rejected them.

const ADMIN_PHONE = '0549109603'

const T = {
  title: 'אין הרשאת גישה',
  body: 'החשבון שאיתו התחברת אינו מורשה לאזור הזה. אם זו טעות, פנה/י למנהל המערכת.',
  call: 'התקשר/י למנהל',
  phone: 'טלפון',
  switch: 'התחברות עם חשבון אחר',
  home: 'חזרה לדף הבית',
  hint: 'טיפ: אם יש לך יותר מחשבון Google אחד, ייתכן שהתחברת עם הלא נכון.',
}

export default function NoAccessPage() {
  const supabase = createClient()
  const [busy, setBusy] = useState(false)

  /** Sign out first, so the account chooser genuinely offers a switch instead
   *  of silently reusing the account that was just refused. */
  async function switchAccount() {
    setBusy(true)
    try { await fetch('/api/auth/signout', { method: 'POST' }) } catch { /* ignore */ }
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    }).catch(() => setBusy(false))
  }

  return (
    <main id="main" tabIndex={-1} style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px)',
      position: 'relative',
    }}>
      <div className="app-bg" aria-hidden />
      <div className="app-scrim" aria-hidden />

      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        {/* iOS-style alert glyph rather than a browser error look */}
        <div aria-hidden style={{
          width: 76, height: 76, margin: '0 auto 18px', borderRadius: 999,
          display: 'grid', placeItems: 'center',
          background: 'radial-gradient(closest-side, rgba(255,107,107,0.22), rgba(255,107,107,0.05))',
          border: '1px solid rgba(255,107,107,0.35)',
          boxShadow: '0 0 34px rgba(255,107,107,0.22)',
          animation: 'rise-in .6s var(--ease) .05s backwards',
        }}>
          <svg viewBox="0 0 24 24" width={36} height={36} fill="none" stroke="#ff6b6b"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.2" />
            <circle cx="12" cy="16.4" r="0.9" fill="#ff6b6b" stroke="none" />
          </svg>
        </div>

        <h1 style={{
          fontSize: '1.6rem', fontWeight: 800, margin: 0, color: 'var(--text)',
          animation: 'rise-in .6s var(--ease) .12s backwards',
        }}>{T.title}</h1>

        <p style={{
          color: 'var(--text-dim)', margin: '10px 0 0', fontSize: '0.92rem', lineHeight: 1.65,
          animation: 'rise-in .6s var(--ease) .2s backwards',
        }}>{T.body}</p>

        {/* The phone number is the point of this page — make it the primary,
            tappable action, not a line of text to copy by hand. */}
        <a href={`tel:${ADMIN_PHONE}`} className="press" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          width: '100%', marginTop: 24, padding: '15px 18px', borderRadius: 15,
          border: 'none', background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
          boxShadow: 'var(--glow)', color: 'var(--bg)', fontSize: '1rem', fontWeight: 700,
          textDecoration: 'none', animation: 'rise-in .6s var(--ease) .28s backwards',
        }}>
          <svg viewBox="0 0 24 24" width={19} height={19} fill="none" stroke="currentColor"
            strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
          </svg>
          <span dir="ltr">{ADMIN_PHONE}</span>
        </a>

        <button onClick={switchAccount} disabled={busy} className="press" style={{
          width: '100%', marginTop: 10, padding: '14px 18px', borderRadius: 15,
          border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
          color: 'var(--text)', fontSize: '0.94rem', fontWeight: 600,
          fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
          animation: 'rise-in .6s var(--ease) .34s backwards',
        }}>{T.switch}</button>

        <p style={{
          color: 'var(--text-faint)', fontSize: '0.78rem', margin: '14px 0 0', lineHeight: 1.6,
          animation: 'rise-in .6s var(--ease) .4s backwards',
        }}>{T.hint}</p>

        <Link href="/" className="press" style={{
          display: 'inline-block', marginTop: 20, padding: '11px 18px', borderRadius: 13,
          border: '1px solid var(--line)', background: 'transparent',
          color: 'var(--text-dim)', textDecoration: 'none', fontWeight: 600, fontSize: '0.88rem',
          animation: 'rise-in .6s var(--ease) .46s backwards',
        }}>← {T.home}</Link>
      </div>
    </main>
  )
}
