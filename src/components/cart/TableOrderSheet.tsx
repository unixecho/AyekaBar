'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { haptic } from '@/lib/haptics'
import { RTL, type Lang } from '@/lib/menu/types'
import { openLines } from '@/lib/cart/store'
import { toSubmission } from '@/lib/cart/submission'
import { TABLE_CODE_LENGTH, isValidTableCodeShape, normalizeTableCode } from '@/lib/cart/otp'
import {
  REMOTE_UI, connectedText, itemsText, remoteErrorText, sanitizeSent,
  type SessionView, type SubmissionState,
} from '@/lib/cart/remote'
import { fmtAgorot } from '@/lib/cart/variants'
import type { Cart } from '@/lib/cart/types'
import SheetShell from './SheetShell'

// "שליחה למלצר" — the customer connects to their table with the waiter's code and sends the cart.
//
// Reached from the cart sheet's footer once the developer's switch is on (CartSheet.tsx keeps the button
// visibly inert until then). It opens ON TOP of the cart, so it takes the keyboard from it via `suspended`
// on the cart's own SheetShell — the same contract the call sheet uses.
//
// ONE SHEET, TWO STATES. Not connected: type the six digits. Connected: send the open round, see what the
// visit has sent and what became of it. Re-opening the sheet after a refresh, a cleared cookie or on a new
// phone is the RECOVERY the owner asked for — type the same digits again and the table's history is back.
//
// NOTHING IS STORED HERE. The phone's right to order is an httpOnly cookie the page cannot read, so this
// component learns whether it is connected only by asking GET /api/table/session. No new localStorage key
// (a key is a privacy disclosure in this app — lib/privacy/registry.ts).
//
// WHAT "SEND" SENDS: the OPEN ROUND only (lines not yet marked "presented"), then marks them presented —
// exactly what the cart's own "הראיתי למלצר" does by hand. So tapping send twice never sends a drink twice,
// and a re-order is a new request. It is a REQUEST: a waiter reviews it and imports it; the sheet says so.

type Phase = 'idle' | 'connecting' | 'sending'
const POLL_MS = 15_000

function parseView(json: unknown): SessionView {
  if (typeof json !== 'object' || json === null) return { connected: false }
  const j = json as Record<string, unknown>
  if (j.connected !== true || typeof j.tableNumber !== 'number' || typeof j.expiresAt !== 'string') return { connected: false }
  return { connected: true, tableNumber: j.tableNumber, expiresAt: j.expiresAt, shiftOpen: j.shiftOpen !== false, sent: sanitizeSent(j.sent) }
}

const STATE_COLOUR: Record<SubmissionState, string> = {
  pending: 'var(--text-dim)', imported: '#3ddc97', rejected: '#ff6b6b', expired: 'var(--text-faint)',
}

export default function TableOrderSheet({
  open, onClose, lang, cart, onSent,
}: {
  open: boolean
  onClose: () => void
  lang: Lang
  cart: Cart
  /** Called after a successful send, so the cart can close the round it just sent. */
  onSent: () => void
}) {
  const dir = RTL[lang] ? 'rtl' : 'ltr'
  const [view, setView] = useState<SessionView | null>(null)   // null = still asking
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [justSent, setJustSent] = useState(false)
  const codeId = useId()
  const errId = useId()
  const busy = useRef(false)

  const open_ = useMemo(() => openLines(cart), [cart])
  const newQty = open_.reduce((n, l) => n + l.qty, 0)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/table/session', { cache: 'no-store' })
      setView(res.ok ? parseView(await res.json().catch(() => null)) : { connected: false })
    } catch {
      // A blip keeps what is on screen; the next poll corrects it.
      setView((cur) => cur ?? { connected: false })
    }
  }, [])

  // A fresh sheet every time it opens, and one look at where the phone stands.
  useEffect(() => {
    if (!open) return
    setCode(''); setError(null); setJustSent(false); setPhase('idle'); setView(null)
    void refresh()
  }, [open, refresh])

  // While open and connected, keep the "what became of it" list current — a waiter taps import in the POS and
  // the customer sees it move from "waiting" to "taken" without doing anything.
  useEffect(() => {
    if (!open || !view?.connected) return
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [open, view?.connected, refresh])

  async function connect() {
    if (busy.current) return
    if (!isValidTableCodeShape(code)) { setError(remoteErrorText('bad_code', lang)); return }
    busy.current = true
    setPhase('connecting'); setError(null); haptic('select')
    try {
      const res = await fetch('/api/table/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) { setError(remoteErrorText(json.error, lang)); return }
      haptic('select')
      setCode('')
      await refresh()
    } catch {
      setError(remoteErrorText('server', lang))
    } finally {
      busy.current = false
      setPhase('idle')
    }
  }

  async function send() {
    if (busy.current || newQty === 0) return
    busy.current = true
    setPhase('sending'); setError(null); setJustSent(false); haptic('select')
    try {
      // The OPEN round only — what the customer has not yet handed over.
      const payload = toSubmission({ ...cart, lines: open_ }, lang)
      const res = await fetch('/api/table/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        setError(remoteErrorText(json.error, lang))
        // A session that has gone is not worth a second guess: show the code box again.
        if (json.error === 'no_session' || json.error === 'ended' || json.error === 'expired') void refresh()
        return
      }
      haptic('select')
      setJustSent(true)
      onSent()
      await refresh()
    } catch {
      setError(remoteErrorText('server', lang))
    } finally {
      busy.current = false
      setPhase('idle')
    }
  }

  async function disconnect() {
    if (busy.current) return
    haptic('select')
    try { await fetch('/api/table/session', { method: 'DELETE' }) } catch { /* the cookie is cleared by the response; nothing to do */ }
    setJustSent(false); setError(null)
    setView({ connected: false })
  }

  const connected = view?.connected === true ? view : null
  const sendBlocked = !connected || newQty === 0 || !connected.shiftOpen || phase !== 'idle'
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : lang === 'ar' ? 'ar' : 'en-GB', { hour: '2-digit', minute: '2-digit' }),
    [lang],
  )

  const footer = (
    // `cart-foot--corner` (cart.css) reserves a clear band at the bottom while the sheet spans the screen — see
    // the note there for why (the accessibility button, measured on a phone, 2026-10-13).
    <div className="cart-foot cart-foot--corner" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {connected ? (
        <>
          <button
            type="button" className="cart-primary press" onClick={send} disabled={sendBlocked}
            style={{ opacity: sendBlocked ? 0.55 : 1, cursor: sendBlocked ? 'not-allowed' : 'pointer' }}
          >
            {phase === 'sending' ? REMOTE_UI.sending[lang] : `${REMOTE_UI.sendButton[lang]}${newQty > 0 ? ` · ${itemsText(newQty, lang)}` : ''}`}
          </button>
          {/* "Close" is first, so in RTL it sits on the right — under the accessibility button, which is fixed to
              the bottom-right corner of every page. The short word clears it; the longer "disconnect" label, which
              used to sit there, had its first letters covered (seen at 375px, 2026-10-13). */}
          {/* auto-fit, not a fixed pair: on a closed Fold (280px) two 119px buttons pushed "Close" under that same
              corner button (its first letter was covered); with no room for two comfortable columns they stack, and
              a centred label on a full-width button is nowhere near the corner. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            <button type="button" className="cart-secondary press" onClick={onClose}>{REMOTE_UI.close[lang]}</button>
            <button type="button" className="cart-secondary press" onClick={disconnect}>{REMOTE_UI.disconnect[lang]}</button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button" className="cart-primary press" onClick={connect}
            disabled={view === null || phase !== 'idle' || !isValidTableCodeShape(code)}
            style={{ opacity: view === null || phase !== 'idle' || !isValidTableCodeShape(code) ? 0.55 : 1 }}
          >
            {phase === 'connecting' ? REMOTE_UI.connecting[lang] : REMOTE_UI.connect[lang]}
          </button>
          <button type="button" className="cart-secondary press" onClick={onClose}>{REMOTE_UI.close[lang]}</button>
        </>
      )}
    </div>
  )

  return (
    <SheetShell open={open} onClose={onClose} label={REMOTE_UI.codeTitle[lang]} dir={dir} footer={footer}>
      <div className="cart-sheet-head">
        <h2 className="cart-sheet-title">{REMOTE_UI.codeTitle[lang]}</h2>
      </div>

      {/* .sheet-scroll is what lets the BODY scroll while the footer stays pinned. Without it (seen in landscape,
          844×390, 2026-10-13) content + footer taller than the panel spilled the footer's buttons out over the
          sheet's lower border instead of the list scrolling. */}
      <div className="sheet-scroll">
      <div style={{ padding: '4px 2px 8px' }}>
        {view === null ? (
          <p role="status" style={{ margin: '12px 0', color: 'var(--text-dim)' }}>…</p>
        ) : !connected ? (
          <>
            <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
              {REMOTE_UI.codeIntro[lang]}
            </p>
            <label className="cart-choice-label" htmlFor={codeId} style={{ display: 'block' }}>{REMOTE_UI.codeLabel[lang]}</label>
            <input
              id={codeId} className="cart-note-input" inputMode="numeric" pattern="[0-9]*"
              // `one-time-code` lets the phone offer a code from a message; it is harmless when there is none.
              autoComplete="one-time-code" maxLength={TABLE_CODE_LENGTH + 4} value={code}
              aria-invalid={!!error} aria-describedby={error ? errId : undefined}
              onChange={(e) => { setCode(normalizeTableCode(e.target.value)); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void connect() }}
              // Digits are LTR in every language, and a code is read aloud in threes.
              dir="ltr" style={{ textAlign: 'center', fontSize: '1.7rem', fontWeight: 800, letterSpacing: 8 }}
            />
            <p style={{ margin: '8px 0 0', fontSize: '0.76rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>{REMOTE_UI.codeHint[lang]}</p>
          </>
        ) : (
          <>
            <p role="status" style={{ margin: '0 0 6px', fontSize: '1.02rem', fontWeight: 800, color: 'var(--text)' }}>
              <span aria-hidden style={{ color: '#3ddc97' }}>● </span>{connectedText(connected.tableNumber, lang)}
            </p>

            {justSent ? (
              <div role="status" style={{ margin: '10px 0', padding: '10px 12px', borderRadius: 14, border: '1px solid #3ddc9755', background: '#3ddc9714' }}>
                <p style={{ margin: 0, fontWeight: 800, color: 'var(--text)' }}><span aria-hidden>✓ </span>{REMOTE_UI.sentTitle[lang]}</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.86rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>{REMOTE_UI.sentBody[lang]}</p>
              </div>
            ) : (
              <p style={{ margin: '0 0 8px', fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>{REMOTE_UI.sendHint[lang]}</p>
            )}

            {!connected.shiftOpen && (
              <p role="alert" style={{ margin: '8px 0', fontSize: '0.86rem', fontWeight: 600, color: '#ffb84d', lineHeight: 1.5 }}>
                {remoteErrorText('no_shift', lang)}
              </p>
            )}
            {newQty === 0 && !justSent && (
              <p style={{ margin: '8px 0', fontSize: '0.84rem', color: 'var(--text-faint)' }}>{REMOTE_UI.nothingNew[lang]}</p>
            )}

            {connected.sent.length > 0 && (
              <section aria-label={REMOTE_UI.yourOrders[lang]} style={{ marginTop: 14 }}>
                <h3 className="cart-choice-label" style={{ margin: '0 0 6px' }}>{REMOTE_UI.yourOrders[lang]}</h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {connected.sent.map((r) => (
                    <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
                      <span dir="ltr" style={{ fontSize: '0.8rem', color: 'var(--text-faint)', flex: '0 0 auto' }}>{timeFmt.format(new Date(r.createdAt))}</span>
                      <span style={{ flex: 1, fontSize: '0.86rem', color: 'var(--text)' }}>
                        {itemsText(r.itemCount, lang)}
                        {r.totalAgorot > 0 && <> · <span dir="ltr">{fmtAgorot(r.totalAgorot)}₪</span></>}
                      </span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: STATE_COLOUR[r.status] }}>{REMOTE_UI.state[r.status][lang]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p style={{ margin: '14px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>{REMOTE_UI.recoverHint[lang]}</p>
          </>
        )}

        {error && (
          <p id={errId} role="alert" style={{ margin: '12px 0 0', fontSize: '0.86rem', fontWeight: 600, color: '#ff6b6b', lineHeight: 1.5 }}>
            {error}
          </p>
        )}
      </div>
      </div>
    </SheetShell>
  )
}
