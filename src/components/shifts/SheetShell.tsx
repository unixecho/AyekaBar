'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import ModalPortal from '@/components/ModalPortal'

// The bottom sheet, extracted so the four sheets in this module share one
// implementation instead of four slightly different ones.
//
// The scroll-lock effect has EMPTY deps and reaches its callback through a
// ref. That is not a style choice — RolePicker documents the bug it prevents:
// an effect whose cleanup has a side effect (restoring body overflow) must not
// depend on an unstable callback, or every keystroke in a contained input
// tears the effect down and rebuilds it. Two sheets in this module contain
// text inputs.

export default function SheetShell({
  title, subtitle, onClose, children, footer, wide = false,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  /** Pinned under the scrolling body — where the primary action belongs on a
   *  phone, within thumb reach and never scrolled away. */
  footer?: ReactNode
  wide?: boolean
}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ModalPortal>
      <div
        role="dialog" aria-modal="true" aria-label={title}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 150,
          // THE BLUR SITS HERE, ON AN ELEMENT THAT NEVER ANIMATES.
          // A `backdrop-filter` costs a full-viewport readback and re-blur on
          // every frame the element it lives on is animated. Fading the blur
          // in meant paying that ~13 times for a 220ms fade, which on a phone
          // is most of the "the sheet takes a moment to open" delay. The
          // material now appears in one composite — the way iOS does it — and
          // only the dim below fades.
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}
      >
        <div aria-hidden style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
          animation: 'fade-in .22s var(--ease)',
        }} />
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            width: '100%', maxWidth: wide ? 720 : 460,
            background: 'var(--bg-elev-2)',
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            border: '1px solid var(--line-strong)', borderBottom: 'none',
            maxHeight: '88dvh', display: 'flex', flexDirection: 'column',
            animation: 'sheet-up .34s var(--ease)',
            willChange: 'transform',
          }}
        >
          <div style={{ padding: '14px 16px 10px', flex: '0 0 auto' }}>
            <div aria-hidden style={{
              width: 38, height: 4, borderRadius: 999, background: 'var(--line-strong)',
              margin: '0 auto 14px',
            }} />
            <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
            {subtitle && (
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {subtitle}
              </p>
            )}
          </div>

          <div style={{
            flex: '1 1 auto', overflowY: 'auto',
            // Nothing inside a sheet should be able to scroll the page behind
            // it once it runs out of its own scroll — the sheet is modal.
            overscrollBehavior: 'contain',
            padding: `4px 16px ${footer ? '10px' : 'calc(env(safe-area-inset-bottom) + 16px)'}`,
          }}>
            {children}
          </div>

          {footer && (
            <div style={{
              flex: '0 0 auto', padding: `10px 16px calc(env(safe-area-inset-bottom) + 14px)`,
              borderTop: '1px solid var(--line)', background: 'var(--bg-elev-2)',
              display: 'flex', gap: 8,
            }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

/** The two button shapes every sheet footer uses, so they stay identical. */
export const sheetPrimary = (enabled = true) => ({
  flex: 1, padding: '13px 0', borderRadius: 14, border: 'none',
  background: enabled ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))' : 'var(--bg-elev)',
  color: enabled ? '#fff' : 'var(--text-faint)',
  fontSize: '0.95rem', fontWeight: 700, fontFamily: 'inherit',
  cursor: enabled ? 'pointer' : 'default',
  boxShadow: enabled ? 'var(--glow)' : 'none',
} as const)

export const sheetSecondary = {
  flex: '0 0 auto', padding: '13px 20px', borderRadius: 14,
  border: '1px solid var(--line)', background: 'transparent',
  color: 'var(--text-dim)', fontSize: '0.95rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
} as const
