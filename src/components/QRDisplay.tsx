'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import QRCode from 'qrcode'

const REFRESH_SECONDS = 15 * 60

export default function QRDisplay() {
  const [qrDataUrl, setQrDataUrl]   = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(REFRESH_SECONDS)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchNewToken = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/loyalty/generate-qr', { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      const { token, expiresAt } = await res.json()
      const msLeft = new Date(expiresAt).getTime() - Date.now()
      setSecondsLeft(Math.max(0, Math.floor(msLeft / 1000)))
      const url = `${window.location.origin}/checkin?token=${encodeURIComponent(token)}`
      const dataUrl = await QRCode.toDataURL(url, {
        width: 260, margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M',
      })
      setQrDataUrl(dataUrl)
    } catch {
      setError('שגיאה בטעינת הקוד')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchNewToken() }, [fetchNewToken])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) { fetchNewToken(); return REFRESH_SECONDS }
        return prev - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [fetchNewToken])

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const pct  = (secondsLeft / REFRESH_SECONDS) * 100
  const urgent = secondsLeft < 60

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{
        width: 268, height: 268, borderRadius: 20,
        background: 'var(--bg-elev)', border: '1px solid var(--line)',
        display: 'grid', placeItems: 'center',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: '3px solid var(--neon)', borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
      <p style={{ color: 'var(--text-faint)', fontSize: '0.88rem' }}>טוען קוד...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      <div style={{
        width: 268, height: 268, borderRadius: 20,
        background: 'var(--bg-elev)', border: '1px solid rgba(255,94,58,0.3)',
        display: 'grid', placeItems: 'center',
      }}>
        <p style={{ color: 'var(--neon-soft)', fontSize: '0.9rem', padding: '0 20px', textAlign: 'center' }}>{error}</p>
      </div>
      <button onClick={fetchNewToken} style={{
        padding: '10px 24px', borderRadius: 12, border: 'none',
        background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
        color: '#fff', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
      }}>נסה שוב</button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
      {/* QR */}
      {qrDataUrl && (
        <div style={{
          borderRadius: 20, overflow: 'hidden',
          border: `3px solid ${urgent ? '#38e1ff' : 'var(--neon)'}`,
          boxShadow: urgent
            ? '0 0 30px rgba(56,225,255,0.4)'
            : 'var(--glow)',
          transition: 'border-color 0.5s, box-shadow 0.5s',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="Loyalty QR Code" width={260} height={260} />
        </div>
      )}

      {/* Countdown */}
      <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ height: 4, width: '100%', borderRadius: 999, background: 'var(--bg-elev-2)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 999,
            background: urgent
              ? 'linear-gradient(135deg, var(--neon-2), #7defff)'
              : 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
            width: `${pct}%`,
            transition: 'width 1s linear, background 0.5s',
          }} />
        </div>
        <p style={{
          textAlign: 'center', fontSize: '0.88rem',
          color: urgent ? 'var(--neon-2)' : 'var(--text-dim)',
        }}>
          מתחדש בעוד{' '}
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '1rem', color: urgent ? 'var(--neon-2)' : 'var(--neon-soft)' }}>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        </p>
      </div>

      <button onClick={fetchNewToken} style={{
        background: 'none', border: 'none',
        color: 'var(--text-faint)', fontSize: '0.78rem',
        cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit',
      }}>
        רענן עכשיו
      </button>
    </div>
  )
}
