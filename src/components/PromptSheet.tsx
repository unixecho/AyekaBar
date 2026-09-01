'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import ModalPortal from '@/components/ModalPortal'

// iOS-style single-line text input, replacing window.prompt().
//
// window.prompt() renders in the OS's own chrome — Latin-first, light, and
// anchored to the top of the browser window, same problem ConfirmSheet fixed
// for window.confirm(). This is that sheet's sibling: one field, autofocus so
// the keyboard is already open by the time the sheet finishes animating in,
// and a primary action that stays disabled until there's something to submit.

export interface PromptRequest {
  title: string
  /** Optional second line — what this name is for, in plain language. */
  body?: string
  placeholder?: string
  defaultValue?: string
  confirmLabel: string
  /** Let the caller submit an EMPTY value. Off by default, because the
   *  original callers (name a floor, name a diner) have nothing to mean by
   *  one. On for editing an OPTIONAL field — the menu cart's per-line note —
   *  where clearing the text IS the edit, and a confirm button that stays
   *  disabled when you delete everything is a control that cannot undo
   *  itself. */
  allowEmpty?: boolean
  onConfirm: (value: string) => void
}

const CANCEL = 'ביטול'

export default function PromptSheet({
  request, onClose,
}: {
  request: PromptRequest | null
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!request) return
    setValue(request.defaultValue ?? '')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Autofocus opens the keyboard immediately — the sheet animates in, the
    // field is already live, the waiter/owner just starts typing.
    const t = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [request, onClose])

  if (!request) return null

  const trimmed = value.trim()
  const canSubmit = request.allowEmpty || !!trimmed
  const submit = () => { if (canSubmit) { request.onConfirm(trimmed); onClose() } }

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
              <input
                ref={inputRef}
                value={value}
                placeholder={request.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                style={inputStyle}
              />
            </div>

            <button
              type="button" className="press" disabled={!canSubmit} onClick={submit}
              style={{ ...confirmStyle, opacity: canSubmit ? 1 : 0.4 }}
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

const inputStyle: CSSProperties = {
  width: '100%', marginTop: 14, padding: '12px 14px', borderRadius: 12,
  border: '1px solid var(--line-strong)', background: 'var(--bg)',
  color: 'var(--text)', fontSize: '1rem', fontFamily: 'inherit',
  textAlign: 'center',
}

const confirmStyle: CSSProperties = {
  width: '100%', padding: '15px 0', border: 'none',
  borderTop: '1px solid var(--line-strong)', background: 'transparent',
  color: 'var(--neon)', fontSize: '1rem', fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer',
}

const cancelStyle: CSSProperties = {
  width: '100%', padding: '15px 0', borderRadius: 18,
  border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)',
  color: 'var(--text)', fontSize: '1rem', fontWeight: 700,
  fontFamily: 'inherit', cursor: 'pointer',
}
