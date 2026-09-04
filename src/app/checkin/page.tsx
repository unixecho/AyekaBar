'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthHandoff, GoogleG } from '@/components/AuthHandoff'
import { Suspense } from 'react'

function CheckinContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [status, setStatus] = useState<'loading' | 'signing-in' | 'checking-in' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [points, setPoints] = useState<number | null>(null)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('קוד QR לא תקין')
      return
    }

    checkUser()
  }, [token])

  async function checkUser() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      // Redirect to sign in, then come back
      setStatus('signing-in')
      return
    }

    await doCheckin()
  }

  async function doCheckin() {
    setStatus('checking-in')

    try {
      const res = await fetch('/api/loyalty/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStatus('error')
        setMessage(data.error ?? 'שגיאה בתהליך הצבירה')
        return
      }

      setStatus('success')
      setPoints(data.totalPoints)
    } catch {
      setStatus('error')
      setMessage('שגיאה בחיבור לשרת. נסה שוב.')
    }
  }

  if (status === 'loading' || status === 'checking-in') {
    return (
      <div className="text-center space-y-4">
        <div className="h-16 w-16 mx-auto animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
        <p className="text-zinc-400">
          {status === 'loading' ? 'טוען...' : 'מאמת את הקוד...'}
        </p>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="text-center space-y-6">
        <div className="text-6xl">🎉</div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-amber-400">נקודה נצברה!</h2>
          <p className="text-zinc-400">
            סה"כ נקודות: <span className="font-bold text-amber-400 text-xl">{points}</span>
          </p>
        </div>
        <button
          onClick={() => router.push('/customer/dashboard')}
          className="w-full rounded-xl bg-amber-500 px-6 py-3 font-semibold text-black hover:bg-amber-400"
        >
          ראה את הנקודות שלי
        </button>
      </div>
    )
  }

  if (status === 'error') {
    // A11y (WCAG 4.1.3): this replaces the page's content via client-side
    // state (checking → error), not a real navigation, so a screen-reader
    // user already on the page needs to be told the check-in failed --
    // found 2026-09-04.
    return (
      <div className="text-center space-y-6" role="alert">
        <div className="text-5xl" aria-hidden>⚠️</div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-red-400">שגיאה</h2>
          <p className="text-zinc-400">{message}</p>
        </div>
        <button
          onClick={() => router.push('/customer/dashboard')}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-6 py-3 font-semibold text-zinc-200 hover:bg-zinc-800"
        >
          חזור לדשבורד
        </button>
      </div>
    )
  }

  // signing-in state: Google only — same interstitial pattern as /login,
  // never a bespoke email/password or magic-link form on a new sign-in
  // surface (see CLAUDE.md, "Auth model").
  return <GoogleSignInPrompt token={token!} />
}

function GoogleSignInPrompt({ token }: { token: string }) {
  const [authOpen, setAuthOpen] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startGoogle() {
    setAuthBusy(true)
    setError(null)
    const supabase = createClient()
    // `next` carries the QR token through Google's round-trip so
    // /auth/callback can send the visitor straight back here instead of to
    // their normal post-login destination. /auth/callback only ever follows
    // a same-origin relative path here — never an open redirect.
    const next = `/checkin?token=${encodeURIComponent(token)}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) {
      setAuthBusy(false)
      setError('שגיאה בהתחברות ל-Google.')
    }
    // success → the browser leaves for Google
  }

  return (
    <>
      <div className="text-center space-y-6">
        <div className="text-4xl">🍺</div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-amber-400">כמעט שם!</h2>
          <p className="text-zinc-400 text-sm">התחברו עם Google כדי לצבור את הנקודה</p>
        </div>
        <button
          onClick={() => setAuthOpen(true)}
          className="w-full rounded-xl bg-white px-6 py-3 font-semibold text-zinc-900 hover:bg-zinc-100 flex items-center justify-center gap-2"
        >
          <GoogleG size={18} />
          המשך עם Google
        </button>
      </div>

      <AuthHandoff
        open={authOpen}
        busy={authBusy}
        error={error}
        lang="he"
        onContinue={startGoogle}
        onClose={() => {
          setAuthOpen(false)
          setError(null)
        }}
      />
    </>
  )
}

export default function CheckinPage() {
  // A11y (WCAG 2.4.2): see no-access/page.tsx's identical comment.
  useEffect(() => { document.title = "צ'ק-אין · אייכה בר" }, [])

  return (
    <main id="main" tabIndex={-1} className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Suspense fallback={
          <div className="text-center">
            <div className="h-8 w-8 mx-auto animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          </div>
        }>
          <CheckinContent />
        </Suspense>
      </div>
    </main>
  )
}
