'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import ModalPortal from '@/components/ModalPortal'
import PdfPages from '@/components/payslips/PdfPages'
import type { PayslipItem } from '@/components/payslips/types'
import { fmtBytes, periodLabel } from '@/lib/payslips/rules'

// The viewing port (2026-10-14): a payslip opens IN the page, full screen, and the next one is a tap away — so reading
// twelve months, or checking everyone's September, is not twelve downloads.
//
// • PDFs are drawn by pdf.js (PdfPages) so a phone gets the same viewer as a desktop; images are plain <img>.
// • Previous / next walk the list the person is looking at (already filtered by the page), newest first. The arrows
//   are written for a right-to-left screen: "previous" (a newer month) is on the right.
// • It is a real dialog: focus moves in, Tab stays inside, Escape closes, focus goes back to where it came from, and
//   the page behind does not scroll. `suspended` hands the keyboard to a confirmation sheet opened on top of it.
// • Nothing is preloaded. Opening a payslip is logged (migration 060), so the neighbours are fetched when they are
//   actually opened and not before.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function PayslipViewer({
  items, index, onIndex, onClose, mode, onAskRemove, suspended, passwords, onPassword,
}: {
  items: PayslipItem[]
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  mode: 'own' | 'all'
  /** Owner only — asks the page to confirm and remove this payslip. */
  onAskRemove?: (item: PayslipItem) => void
  /** True while a confirmation sheet owns the keyboard. */
  suspended: boolean
  /** In-memory only: staff id → the password that opened their last PDF. */
  passwords: Record<string, string>
  onPassword: (staffId: string, password: string) => void
}) {
  const item = items[index]
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const hasPrev = index > 0
  const hasNext = index < items.length - 1
  const go = useCallback((i: number) => {
    if (i < 0 || i >= items.length) return
    onIndex(i)
  }, [items.length, onIndex])

  // A new payslip starts at the top with no stale error.
  useEffect(() => {
    setFailed(null)
    bodyRef.current?.scrollTo({ top: 0 })
  }, [item?.id])

  // Scroll lock + focus in + focus back.
  useEffect(() => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => closeRef.current?.focus(), 60)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
      const a = document.activeElement
      if (!a || a === document.body || rootRef.current?.contains(a)) returnFocusTo.current?.focus?.()
    }
  }, [])

  // Keyboard: Escape closes; the arrows walk the list (RTL: the right arrow goes to the previous = newer month);
  // Tab wraps inside the dialog.
  useEffect(() => {
    if (suspended) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (!typing && e.key === 'ArrowRight') { e.preventDefault(); go(index - 1); return }
      if (!typing && e.key === 'ArrowLeft') { e.preventDefault(); go(index + 1); return }
      if (e.key !== 'Tab') return
      const list = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (!list.length) return
      const first = list[0], last = list[list.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!rootRef.current?.contains(active)
      if (e.shiftKey) { if (active === first || !inside) { e.preventDefault(); last.focus() } }
      else if (active === last || !inside) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [suspended, index, go, onClose])

  if (!item) return null
  const label = `תלוש שכר ${periodLabel(item.period)}${mode === 'all' ? ` — ${item.staffName}` : ''}`
  const src = `/api/payslips/file?id=${encodeURIComponent(item.id)}`

  return (
    <ModalPortal>
      <div ref={rootRef} className="pv-root" role="dialog" aria-modal="true" aria-label={label} dir="rtl">
        <div className="pv-bar">
          <div className="pv-title">
            <strong>{periodLabel(item.period)}</strong>
            <span>{mode === 'all' ? `${item.staffName} · ` : ''}{index + 1} מתוך {items.length} · {item.file_mime === 'application/pdf' ? 'PDF' : 'תמונה'} {fmtBytes(item.file_bytes)}</span>
          </div>
          <div className="pv-actions">
            <button type="button" className="pv-btn press" onClick={() => go(index - 1)} disabled={!hasPrev} aria-label="התלוש הקודם (חודש חדש יותר)">
              <span aria-hidden>→</span><span className="pv-lbl">קודם</span>
            </button>
            <button type="button" className="pv-btn press" onClick={() => go(index + 1)} disabled={!hasNext} aria-label="התלוש הבא (חודש ישן יותר)">
              <span className="pv-lbl">הבא</span><span aria-hidden>←</span>
            </button>
            <a className="pv-btn press" href={`${src}&download=1`} aria-label="הורדת התלוש הזה">
              <span aria-hidden>⬇</span><span className="pv-lbl">הורדה</span>
            </a>
            {mode === 'all' && onAskRemove && (
              <button type="button" className="pv-btn press" data-danger="true" onClick={() => onAskRemove(item)} aria-label="הסרת התלוש">
                <span aria-hidden>🗑</span><span className="pv-lbl">הסרה</span>
              </button>
            )}
            <button ref={closeRef} type="button" className="pv-btn press" onClick={onClose} aria-label="סגירה">
              <span aria-hidden>✕</span><span className="pv-lbl">סגירה</span>
            </button>
          </div>
        </div>

        <div ref={bodyRef} className="pv-body">
          <div className="pv-inner">
            {failed ? (
              <div className="pv-fail" role="alert">
                <div aria-hidden style={{ fontSize: '1.8rem' }}>⚠️</div>
                <p style={{ margin: 0, fontWeight: 800, fontSize: '1rem' }}>לא הצלחנו להציג את התלוש כאן</p>
                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                  אפשר להוריד אותו ולפתוח במכשיר. ({failed})
                </p>
                <a className="pv-btn press" style={{ justifyContent: 'center' }} href={`${src}&download=1`}>⬇ הורדה</a>
                <a className="pv-btn press" style={{ justifyContent: 'center' }} href={src} target="_blank" rel="noopener noreferrer">פתיחה בכרטיסייה חדשה</a>
              </div>
            ) : item.file_mime === 'application/pdf' ? (
              <PdfPages
                key={item.id} src={src} label={label}
                savedPassword={passwords[item.staff_id]}
                onPasswordAccepted={(pw) => onPassword(item.staff_id, pw)}
                onStatus={(s, detail) => { if (s === 'error') setFailed(detail ?? 'שגיאה') }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={item.id} className="pv-img" src={src} alt={label} onError={() => setFailed('התמונה לא נטענה')} />
            )}
            {item.note && <p style={{ margin: '14px 0 0', fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>הערה: {item.note}</p>}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
