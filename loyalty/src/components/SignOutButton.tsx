'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SignOutButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  const handleSignOut = async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/signout', { method: 'POST' })
      if (res.ok) {
        router.push('/')
      }
    } catch (error) {
      console.error('Sign out failed:', error)
      setIsLoading(false)
    }
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={isLoading}
      style={{
        padding: '8px 12px',
        fontSize: '0.75rem',
        fontWeight: 600,
        border: '1px solid var(--line)',
        borderRadius: 8,
        background: 'var(--bg-elev)',
        color: 'var(--text)',
        cursor: isLoading ? 'not-allowed' : 'pointer',
        opacity: isLoading ? 0.6 : 1,
        transition: 'opacity 150ms ease',
      }}
    >
      {isLoading ? 'יוצא...' : 'התנתק'}
    </button>
  )
}
