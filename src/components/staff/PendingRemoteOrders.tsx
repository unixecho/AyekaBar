'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { armAudioUnlock, buzz, playDing } from '@/lib/staff/ding'

// "Orders waiting" on the staff home — what a customer sent from their table and no waiter has taken yet.
// Built 2026-10-13 (migration 058; PLAN_MENU_CART.md §12).
//
// WHY IT EXISTS. Staff who work from the saved portal rather than the POS (staff.ayeka.bar) get the push
// notification here; tapping it lands on this page, and this card is what it lands ON. The review and the import
// happen in the POS — it shows the lines, re-prices them from the live menu and adds them to the table — so this
// card only says WHICH tables are waiting and sends the person there.
//
// A SIGNAL RENDERS ONLY WHEN IT IS TRUE (the owner dashboard's rule — see SignalStack): with nothing waiting this
// component returns null. There is no "all clear" card, and before migration 058 is applied, or off shift, or for
// someone who is not a recipient, the list is simply empty and the card is simply not there.
//
// A NEW order dings and buzzes once, where the platform allows it (lib/staff/ding.ts) — the page is open and
// someone may be looking at it. The first load stays quiet: opening the page is not an arrival.

interface WaitingOrder { id: string; tableNumber: number | null; itemCount: number; totalAgorot: number; createdAt: string }

const POLL_MS = 10_000
const POS_URL = 'https://staff.ayeka.bar'

const T = {
  title: 'הזמנות מהשולחנות',
  table: 'שולחן',
  items: 'פריטים',
  waiting: 'ממתין',
  open: 'פתחו בקופה',
  hint: 'ההזמנה נבדקת ונוספת לשולחן בקופה.',
}

const shekel = (agorot: number) => {
  const v = Math.max(0, agorot) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function ago(createdAt: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000))
  return mins < 1 ? 'עכשיו' : `לפני ${mins} דק׳`
}

export default function PendingRemoteOrders() {
  const [orders, setOrders] = useState<WaitingOrder[]>([])
  const known = useRef<Set<string> | null>(null)   // null until the first answer arrives

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/staff/orders', { cache: 'no-store' })
      if (!res.ok) return                               // a blip keeps what is on screen
      const json = (await res.json()) as { orders?: WaitingOrder[] }
      const rows = Array.isArray(json.orders) ? json.orders : []
      const fresh = rows.filter((o) => !known.current?.has(o.id))
      // The first answer only establishes what is already there.
      if (known.current !== null && fresh.length > 0) { playDing(); buzz() }
      known.current = new Set(rows.map((o) => o.id))
      setOrders(rows)
    } catch { /* offline: the next poll tries again */ }
  }, [])

  useEffect(() => {
    void load()
    const disarm = armAudioUnlock()
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    // The service worker tells an open page the moment a push arrives, so the card does not wait for the poll.
    const onMessage = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'staff-alert') void load() }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      disarm()
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      navigator.serviceWorker?.removeEventListener('message', onMessage)
    }
  }, [load])

  if (orders.length === 0) return null

  return (
    <section
      aria-labelledby="pending-orders" role="status"
      className="rise"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--neon-soft, var(--line-strong))', borderRadius: 18, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h2 id="pending-orders" style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text)' }}>
        <span aria-hidden>🛎️ </span>{T.title} ({orders.length})
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {orders.map((o) => (
          <li key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, border: '1px solid var(--line)' }}>
            <b style={{ color: 'var(--text)' }}>{T.table} {o.tableNumber ?? '?'}</b>
            <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--text-dim)' }}>
              {o.itemCount} {T.items} · <span dir="ltr">₪{shekel(o.totalAgorot)}</span> · {T.waiting} {ago(o.createdAt)}
            </span>
          </li>
        ))}
      </ul>
      <a
        href={POS_URL} target="_blank" rel="noopener noreferrer" className="press"
        style={{ alignSelf: 'flex-start', fontSize: '0.86rem', fontWeight: 800, color: 'var(--neon-soft)', textDecoration: 'none', border: '1px solid var(--line-strong)', borderRadius: 999, padding: '7px 14px' }}
      >
        {T.open} ↗
      </a>
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)' }}>{T.hint}</p>
    </section>
  )
}
