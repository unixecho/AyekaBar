'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { BADGE_OPTIONS, badgeMeta } from '@/lib/staff/badges'
import ModalPortal from '@/components/ModalPortal'

// iOS-style picker. A native <select> renders as the OS dropdown — grey,
// left-aligned, ignores the app's type and dark palette, and looks nothing
// like the rest of the product. This is the action-sheet pattern instead:
// tap a row, a sheet rises from the bottom, options are big tap targets with
// a check on the current one. Custom labels ("Dev") get their own field, so
// the preset list stays short.

const T = {
  title: 'תפקיד',
  subtitle: 'איך התפקיד יוצג בעמוד הצוות באתר.',
  custom: 'תווית מותאמת אישית',
  customPh: 'למשל: Dev',
  save: 'שמירה',
  cancel: 'ביטול',
}

export default function RolePicker({
  value, disabled = false, onChange,
}: {
  value: string | null
  disabled?: boolean
  onChange: (badge: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = badgeMeta(value, 'staff')
  const isPreset = !!value && BADGE_OPTIONS.some((b) => b.key === value)

  return (
    <>
      <button
        type="button" onClick={() => setOpen(true)} disabled={disabled}
        aria-haspopup="dialog" className="press"
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '7px 11px', borderRadius: 999,
          border: `1px solid ${current.color}44`, background: `${current.color}14`,
          color: current.color, fontSize: '0.82rem', fontWeight: 600,
          fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <span aria-hidden>{current.emoji}</span>
        {current.he}
        <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor"
          strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75 }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <Sheet
          value={value}
          customInitial={isPreset ? '' : (value ?? '')}
          onClose={() => setOpen(false)}
          onPick={(badge) => { onChange(badge); setOpen(false) }}
        />
      )}
    </>
  )
}

function Sheet({ value, customInitial, onClose, onPick }: {
  value: string | null
  customInitial: string
  onClose: () => void
  onPick: (badge: string) => void
}) {
  const [custom, setCustom] = useState(customInitial)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Escape closes, and the background must not scroll behind the sheet.
  //
  // The dependency array is deliberately EMPTY. It used to be `[onClose]`,
  // and the caller passes `onClose={() => setOpen(false)}` — a fresh closure
  // every render. Since this sheet contains a text input, every keystroke
  // re-rendered it, changed the identity, and made React tear the effect down
  // and rebuild it: the cleanup restored `body.style.overflow` and the setup
  // re-locked it, once per character. The same defect in the staff app's
  // Sheet (whose cleanup restores FOCUS) made it impossible to type a name at
  // all.
  //
  // RULE: an effect whose cleanup has a side effect — scroll lock, focus
  // restore, pointer capture — must not depend on an unstable callback. Empty
  // deps, and reach the current callback through a ref.
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

  const trimmed = custom.trim()

  return (
    <ModalPortal>
      <div
        role="dialog" aria-modal="true" aria-label={T.title}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 100,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          animation: 'fade-in .22s var(--ease)',
        }}
      >
        <div
          ref={sheetRef} onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460,
            background: 'var(--bg-elev-2)',
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            border: '1px solid var(--line-strong)', borderBottom: 'none',
            padding: `14px 16px calc(env(safe-area-inset-bottom) + 16px)`,
            maxHeight: '85dvh', overflowY: 'auto',
            animation: 'sheet-up .34s var(--ease)',
          }}
        >
          {/* grabber */}
          <div aria-hidden style={{
            width: 38, height: 4, borderRadius: 999, background: 'var(--line-strong)',
            margin: '0 auto 14px',
          }} />

          <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</h3>
          <p style={{ margin: '3px 0 14px', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
            {T.subtitle}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {BADGE_OPTIONS.map((b) => {
              const active = value === b.key
              return (
                <button
                  key={b.key} type="button" onClick={() => onPick(b.key)} className="press"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11, width: '100%',
                    padding: '13px 14px', borderRadius: 14,
                    border: `1px solid ${active ? `${b.color}66` : 'var(--line)'}`,
                    background: active ? `${b.color}18` : 'var(--bg-elev)',
                    color: 'var(--text)', font: 'inherit', fontSize: '0.95rem',
                    fontWeight: 600, cursor: 'pointer', textAlign: 'start',
                  }}
                >
                  <span aria-hidden style={{ fontSize: '1.1rem' }}>{b.emoji}</span>
                  <span style={{ flex: 1 }}>{b.he}</span>
                  {active && (
                    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke={b.color}
                      strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12.5l5 5L20 6.5" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>

          {/* Custom label — for anything the presets don't cover. */}
          <div style={{ marginTop: 16 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>
              {T.custom}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={custom} onChange={(e) => setCustom(e.target.value)}
                placeholder={T.customPh} maxLength={24}
                onKeyDown={(e) => { if (e.key === 'Enter' && trimmed) onPick(trimmed) }}
                style={{
                  flex: 1, minWidth: 0, padding: '12px 13px', borderRadius: 12,
                  border: '1px solid var(--line-strong)', background: 'var(--bg-elev)',
                  color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none',
                }}
              />
              <button
                type="button" disabled={!trimmed} onClick={() => onPick(trimmed)} className="press"
                style={{
                  flex: '0 0 auto', padding: '0 18px', borderRadius: 12, border: 'none',
                  background: trimmed
                    ? 'linear-gradient(135deg, var(--neon), var(--neon-soft))'
                    : 'var(--bg-elev)',
                  color: trimmed ? '#fff' : 'var(--text-faint)',
                  fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit',
                  cursor: trimmed ? 'pointer' : 'default',
                  boxShadow: trimmed ? 'var(--glow)' : 'none',
                }}
              >{T.save}</button>
            </div>
          </div>

          <button type="button" onClick={onClose} className="press" style={cancelStyle}>
            {T.cancel}
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}

const cancelStyle: CSSProperties = {
  width: '100%', marginTop: 12, padding: '13px 0', borderRadius: 14,
  border: '1px solid var(--line)', background: 'transparent',
  color: 'var(--text-dim)', fontSize: '0.95rem', fontWeight: 600,
  fontFamily: 'inherit', cursor: 'pointer',
}
