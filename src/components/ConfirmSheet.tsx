'use client'

import { useEffect, useRef, type CSSProperties } from 'react'
import ModalPortal from '@/components/ModalPortal'

// iOS-style destructive confirmation, replacing window.confirm().
//
// The native dialog renders in the OS's own chrome — Latin-first, light, and
// anchored to the top of the browser window — which reads as a bug on a dark
// RTL app. This is the action-sheet pattern iOS uses for destructive choices:
// the dangerous action is its own red row, cancel is a separate large button.

export interface ConfirmRequest {
  title: string
  /** Optional second line — the consequence, in plain language. */
  body?: string
  /** Label of the destructive action, e.g. "הסרה". */
  confirmLabel: string
  onConfirm: () => void
}

const CANCEL = 'ביטול'

export default function ConfirmSheet({
  request, onClose,
}: {
  request: ConfirmRequest | null
  onClose: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus the destructive action so the sheet is keyboard-operable, but it
    // still takes a deliberate Enter — nothing is destroyed by opening it.
    confirmRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [request, onClose])

  if (!request) return null

  return (
    <ModalPortal>
      <div
        role="dialog" aria-modal="true" aria-label={request.title}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          animation: 'fade-in .22s var(--ease)',
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460,
            padding: `0 10px calc(env(safe-area-inset-bottom) + 10px)`,
            animation: 'sheet-up .34s var(--ease)',
          }}
        >
          <div style={{
            background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)',
            borderRadius: 18, overflow: 'hidden', marginBottom: 8,
          }}>
            <div style={{ padding: '18px 18px 14px', textAlign: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>
                {request.title}
              </h3>
              {request.body && (
                <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
                  {request.body}
                </p>
              )}
            </div>

            <button
              ref={confirmRef} type="button" className="press"
              onClick={() => { request.onConfirm(); onClose() }}
              style={{
                width: '100%', padding: '15px 0', border: 'none',
                borderTop: '1px solid var(--line-strong)', background: 'transparent',
                color: '#ff6b6b', fontSize: '1rem', fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer',
              }}
            >
              {request.confirmLabel}
            </button>
          </div>

          <button type="button" onClick={onClose} className="press" style={cancelStyle}>
            {CANCEL}
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}

const cancelStyle: CSSProperties = {
  width: '100%', padding: '15px 0', borderRadius: 18,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
  color: 'var(--text)', fontSize: '1rem', fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer',
}
