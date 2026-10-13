'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { haptic } from '@/lib/haptics'
import { RTL, type Lang } from '@/lib/menu/types'
import {
  CALL_KINDS, CALL_TABLE_MAX, CALL_TABLE_MIN, CALL_UI, callErrorText,
  type CallKind,
} from '@/lib/waiter/calls'
import SheetShell from './SheetShell'

// "קריאה למלצר" — the customer asks for a waiter, the bill or help.
//
// Reached from the cart sheet's footer once the developer's switch is on
// (CartSheet.tsx keeps the button visibly inert until then). Opens ON TOP of
// the cart, so it takes the keyboard from it via `suspended` on the cart's
// own SheetShell — the same contract PromptSheet/ConfirmSheet use.
//
// Nothing is persisted: the table number lives in this component's state for
// as long as the sheet is open. A new localStorage key is a privacy
// DISCLOSURE in this app (lib/privacy/registry.ts), and a number typed in two
// seconds does not earn one. A customer who calls twice types it twice.

type Phase = 'form' | 'sending' | 'sent'

export default function CallWaiterSheet({
  open, onClose, lang, cartItems, cartAgorot,
}: {
  open: boolean
  onClose: () => void
  lang: Lang
  /** How many lines the customer's cart holds; 0 = they have not ordered. */
  cartItems: number
  cartAgorot: number
}) {
  const dir = RTL[lang] ? 'rtl' : 'ltr'
  const [kind, setKind] = useState<CallKind>('waiter')
  const [table, setTable] = useState('')
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)
  const tableId = useId()
  const errId = useId()
  const sending = useRef(false)

  // A fresh sheet every time it opens, so yesterday's "sent" never greets a
  // new call. The table number is kept between opens ONLY within one visit to
  // the page (component state, gone on reload).
  useEffect(() => {
    if (open) { setPhase('form'); setError(null); setKind('waiter') }
  }, [open])

  const tableNumber = Number(table)
  const tableOk = /^\d{1,3}$/.test(table.trim()) && tableNumber >= CALL_TABLE_MIN && tableNumber <= CALL_TABLE_MAX

  async function send() {
    if (sending.current || !tableOk) {
      if (!tableOk) setError(callErrorText('bad_table', lang))
      return
    }
    sending.current = true
    setPhase('sending'); setError(null); haptic('select')
    try {
      const res = await fetch('/api/table/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableNumber, kind,
          cartItems: Math.min(cartItems, 500),
          cartTotalAgorot: Math.max(0, Math.min(Math.round(cartAgorot), 100_000_000)),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setError(callErrorText(json.error, lang))
        setPhase('form')
        return
      }
      haptic('select')
      setPhase('sent')
    } catch {
      setError(callErrorText('server', lang))
      setPhase('form')
    } finally {
      sending.current = false
    }
  }

  const footer = (
    <div className="cart-foot" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {phase === 'sent' ? (
        <button type="button" className="cart-primary press" onClick={onClose}>{CALL_UI.close[lang]}</button>
      ) : (
        <>
          <button
            type="button" className="cart-primary press" onClick={send}
            disabled={phase === 'sending' || !tableOk}
            style={{ opacity: phase === 'sending' || !tableOk ? 0.55 : 1 }}
          >
            {phase === 'sending' ? CALL_UI.sending[lang] : CALL_UI.send[lang]}
          </button>
          <button type="button" className="cart-secondary press" onClick={onClose}>{CALL_UI.close[lang]}</button>
        </>
      )}
    </div>
  )

  return (
    <SheetShell open={open} onClose={onClose} label={CALL_UI.title[lang]} dir={dir} footer={footer}>
      <div className="cart-sheet-head">
        <h2 className="cart-sheet-title">{CALL_UI.title[lang]}</h2>
      </div>

      {phase === 'sent' ? (
        // role="status" so a screen reader announces the confirmation; the
        // sheet's own focus does not move (the primary button is below).
        <div role="status" style={{ padding: '12px 2px 8px' }}>
          <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>
            <span aria-hidden>✓ </span>{CALL_UI.sentTitle[lang]}
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '0.92rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {CALL_UI.sentBody[lang]}
          </p>
        </div>
      ) : (
        <div style={{ padding: '4px 2px 8px' }}>
          <p style={{ margin: '0 0 6px', fontSize: '0.86rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
            {CALL_UI.intro[lang]}
          </p>

          <div className="cart-choice-label" id={`${tableId}-kind`}>{CALL_UI.kindLabel[lang]}</div>
          <div className="cart-choice-row" role="radiogroup" aria-labelledby={`${tableId}-kind`}>
            {CALL_KINDS.map((k) => (
              <button
                key={k} type="button" role="radio" aria-checked={kind === k}
                className="cart-choice" data-on={kind === k}
                onClick={() => { haptic('select'); setKind(k) }}
              >
                {CALL_UI.kinds[k][lang]}
              </button>
            ))}
          </div>

          <label className="cart-choice-label" htmlFor={tableId} style={{ display: 'block' }}>
            {CALL_UI.tableLabel[lang]}
          </label>
          <input
            id={tableId} className="cart-note-input" inputMode="numeric" pattern="[0-9]*"
            autoComplete="off" maxLength={3} value={table}
            aria-invalid={!!error} aria-describedby={error ? errId : undefined}
            onChange={(e) => { setTable(e.target.value.replace(/[^\d]/g, '')); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
            // The number is a LATIN numeral in every language (it is what is
            // printed on the table), so the field is always LTR.
            dir="ltr" style={{ textAlign: 'center', fontSize: '1.4rem', fontWeight: 800, letterSpacing: 2 }}
          />
          <p style={{ margin: '6px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)' }}>{CALL_UI.tableHint[lang]}</p>

          {cartItems > 0 && (
            <p style={{ margin: '12px 0 0', fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              <span aria-hidden>🛒 </span>{CALL_UI.cartNote[lang]}
            </p>
          )}

          {error && (
            <p id={errId} role="alert" style={{ margin: '12px 0 0', fontSize: '0.86rem', fontWeight: 600, color: '#ff6b6b', lineHeight: 1.5 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </SheetShell>
  )
}
