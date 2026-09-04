'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SignOutButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  // A11y (WCAG 3.3.1 / 4.1.3): a failure here previously produced ZERO
  // user-facing feedback — console.error only. Worse than the missing
  // announcement the audit flagged: if the fetch itself succeeded but
  // returned a non-ok response (no throw), isLoading was never reset at
  // all — the button got permanently stuck on "יוצא…", disabled, with no
  // way to retry and nothing telling anyone why. Found 2026-09-04.
  const [error, setError] = useState<string | null>(null)

  const handleSignOut = async () => {
    if (isLoading) return
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST' })
      if (res.ok) {
        router.push('/')
        return
      }
      setError('ההתנתקות נכשלה. נסה/י שוב.')
    } catch {
      setError('שגיאה בחיבור. נסה/י שוב.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        onClick={handleSignOut}
        aria-disabled={isLoading} aria-busy={isLoading}
        style={{
          padding: '8px 12px',
          fontSize: '0.75rem',
          fontWeight: 600,
          border: '1px solid var(--line)',
          borderRadius: 8,
          background: 'var(--bg-elev)',
          color: 'var(--text)',
          cursor: isLoading ? 'progress' : 'pointer',
          opacity: isLoading ? 0.6 : 1,
          transition: 'opacity 150ms ease',
        }}
      >
        {isLoading ? 'יוצא...' : 'התנתק'}
      </button>
      {error && <span role="alert" style={{ fontSize: '0.72rem', color: '#ff6b6b' }}>{error}</span>}
    </div>
  )
}
