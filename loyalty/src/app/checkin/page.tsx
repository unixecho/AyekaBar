'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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

  async function handleSignIn(email: string) {
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/checkin?token=${encodeURIComponent(token!)}`,
      },
    })

    if (error) {
      setStatus('error')
      setMessage('שגיאה בשליחת קישור הכניסה')
      return
    }

    setStatus('signing-in')
    setMessage('שלחנו קישור למייל שלך — לחץ עליו כדי להשלים את הצבירה')
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
    return (
      <div className="text-center space-y-6">
        <div className="text-5xl">⚠️</div>
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

  // signing-in state: show email form
  return (
    <SignInForm onSubmit={handleSignIn} message={message} />
  )
}

function SignInForm({
  onSubmit,
  message,
}: {
  onSubmit: (email: string) => void
  message: string
}) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  if (message) {
    return (
      <div className="text-center space-y-4">
        <div className="text-4xl">📧</div>
        <p className="text-zinc-300">{message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="text-4xl">🍺</div>
        <h2 className="text-xl font-bold text-amber-400">כמעט שם!</h2>
        <p className="text-zinc-400 text-sm">הזן את המייל שלך כדי לצבור את הנקודה</p>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault()
          setLoading(true)
          await onSubmit(email)
          setLoading(false)
        }}
        className="space-y-4"
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          required
          dir="ltr"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !email}
          className="w-full rounded-xl bg-amber-500 px-6 py-3 font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {loading ? '...' : 'צבור נקודה'}
        </button>
      </form>
    </div>
  )
}

export default function CheckinPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
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
