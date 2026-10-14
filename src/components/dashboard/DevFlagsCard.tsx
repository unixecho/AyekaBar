'use client'

import { useCallback, useEffect, useState } from 'react'
import Switch from '@/components/Switch'

// The developer's in-development switches (/owner/dev). Two today, both BUILT end to end (2026-10-13) and both
// SHIPPED OFF — "I want to test it for now":
//
//   • "קריאה למלצר" — the customer asks for a waiter, the bill or help from the cart; the POS shows it to whoever
//     is on shift.
//   • "שליחת הזמנה למלצר" — a customer a waiter has given a 6-digit code connects to their table and sends their
//     cart; the waiters on shift are notified (the POS if they are signed in there, otherwise this site), and one
//     of them reviews it and adds it to the table's order.
//
// Turning one on makes its button on the customer's cart live and its endpoints start accepting requests; turning
// it off takes it away again within a minute (the settings read is cached, the PATCH busts the cache) — and the
// endpoints re-check the switch themselves, so hiding the button is not what keeps them closed.
//
// Lives here and not on the owner's pages on purpose — see the long note on /api/owner/dev/flags. Optimistic with
// rollback, like every switch in the app.

const T = {
  title: 'מתגי פיצ\'רים בפיתוח',
  call: 'קריאה למלצר מהתפריט',
  callOn: 'דלוק — לקוחות בתפריט יכולים לקרוא למלצר, והקופה מקבלת התראה.',
  callOff: 'כבוי — הכפתור בעגלה מוצג כ"בקרוב" ואינו פעיל.',
  callNeeds: 'דורש שמיגרציה 057 תופעל. בלעדיה הלקוח יקבל הודעת שגיאה רגועה והקופה לא תציג כלום.',
  ordering: 'שליחת הזמנה למלצר מהתפריט',
  orderingOn: 'דלוק — לקוח שקיבל קוד מהמלצר יכול לשלוח את הרשימה, והמלצרים במשמרת מקבלים התראה.',
  orderingOff: 'כבוי — הכפתור בעגלה מוצג כ"בקרוב" ואינו פעיל, וה-API סגור.',
  orderingNeeds: 'דורש שמיגרציה 058 תופעל ושהקופה (staff.ayeka.bar) תהיה על הגרסה החדשה. בלעדיהן הלקוח יקבל הודעת שגיאה רגועה. בדקו בבדיקת המערכת למטה.',
  loading: 'טוען…',
  failed: 'השמירה נכשלה. נסו שוב.',
  loadFailed: 'הטעינה נכשלה.',
}

type FlagKey = 'waiterCallEnabled' | 'tableOrderingEnabled'

export default function DevFlagsCard() {
  const [flags, setFlags] = useState<Record<FlagKey, boolean | null>>({ waiterCallEnabled: null, tableOrderingEnabled: null })
  const [busy, setBusy] = useState<FlagKey | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/dev/flags', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setFlags({ waiterCallEnabled: j.waiterCallEnabled === true, tableOrderingEnabled: j.tableOrderingEnabled === true })
    } catch {
      setFlags({ waiterCallEnabled: null, tableOrderingEnabled: null }); setMsg(T.loadFailed)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function toggle(key: FlagKey) {
    const current = flags[key]
    if (current === null || busy) return
    const next = !current
    setBusy(key); setMsg(null); setFlags((f) => ({ ...f, [key]: next }))
    try {
      const res = await fetch('/api/owner/dev/flags', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error)
      setFlags((f) => ({ ...f, [key]: j[key] === true }))
    } catch {
      setFlags((f) => ({ ...f, [key]: current })); setMsg(T.failed)
    } finally {
      setBusy(null)
    }
  }

  const rows: { key: FlagKey; title: string; on: string; off: string; needs: string }[] = [
    { key: 'waiterCallEnabled', title: T.call, on: T.callOn, off: T.callOff, needs: T.callNeeds },
    { key: 'tableOrderingEnabled', title: T.ordering, on: T.orderingOn, off: T.orderingOff, needs: T.orderingNeeds },
  ]

  return (
    <section aria-labelledby="dev-flags" className="rise" style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 18, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 id="dev-flags" style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</h2>

      {rows.map((r, i) => {
        const on = flags[r.key]
        return (
          <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(i > 0 ? { borderTop: '1px solid var(--line)', paddingTop: 12 } : null) }}>
            <button
              type="button" role="switch" aria-checked={on ?? false} aria-describedby={`dev-${r.key}-desc`}
              disabled={on === null || busy !== null} onClick={() => toggle(r.key)} className="press"
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: 0, border: 'none', background: 'none', font: 'inherit', cursor: on === null ? 'default' : 'pointer', textAlign: 'start' }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>{r.title}</span>
                <span id={`dev-${r.key}-desc`} style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5 }}>
                  {on === null ? T.loading : on ? r.on : r.off}
                </span>
              </span>
              <Switch on={on === true} />
            </button>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.55 }}>{r.needs}</p>
          </div>
        )
      })}

      {msg && <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: '#ff6b6b' }}>{msg}</p>}
    </section>
  )
}
