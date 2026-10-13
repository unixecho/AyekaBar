'use client'

import { useCallback, useEffect, useState } from 'react'
import Switch from '@/components/Switch'

// The developer's in-development switches (/owner/dev). One today: "קריאה
// למלצר" in the customer menu — built end to end (2026-10-13) but SHIPPED OFF,
// "I want to test it for now". Turning it on makes the button on the customer's
// cart live and POST /api/table/call start writing calls that the POS shows to
// whoever is on shift; turning it off takes it away again within a minute (the
// settings read is cached, the PATCH busts the cache).
//
// Lives here and not on the owner's pages on purpose — see the long note on
// /api/owner/dev/flags. Optimistic with rollback, like every switch in the app.

const T = {
  title: 'מתגי פיצ\'רים בפיתוח',
  call: 'קריאה למלצר מהתפריט',
  callOn: 'דלוק — לקוחות בתפריט יכולים לקרוא למלצר, והקופה מקבלת התראה.',
  callOff: 'כבוי — הכפתור בעגלה מוצג כ"בקרוב" ואינו פעיל.',
  callNeeds: 'דורש שמיגרציה 057 תופעל. בלעדיה הלקוח יקבל הודעת שגיאה רגועה והקופה לא תציג כלום.',
  ordering: 'שליחת הזמנה למלצר',
  orderingBody: 'לא נבנה עדיין (שלב 2 — קוד בן 6 ספרות מהמלצר). אין מתג.',
  loading: 'טוען…',
  failed: 'השמירה נכשלה. נסו שוב.',
  loadFailed: 'הטעינה נכשלה.',
}

export default function DevFlagsCard() {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/dev/flags', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setOn(j.waiterCallEnabled === true)
    } catch {
      setOn(null); setMsg(T.loadFailed)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function toggle() {
    if (on === null || busy) return
    const next = !on
    setBusy(true); setMsg(null); setOn(next)
    try {
      const res = await fetch('/api/owner/dev/flags', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiterCallEnabled: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error)
      setOn(j.waiterCallEnabled === true)
    } catch {
      setOn(!next); setMsg(T.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="dev-flags" className="rise" style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 18, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 id="dev-flags" style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</h2>

      <button
        type="button" role="switch" aria-checked={on ?? false} aria-describedby="dev-call-desc"
        disabled={on === null || busy} onClick={toggle} className="press"
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: 0, border: 'none', background: 'none', font: 'inherit', cursor: on === null ? 'default' : 'pointer', textAlign: 'start' }}
      >
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>{T.call}</span>
          <span id="dev-call-desc" style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5 }}>
            {on === null ? T.loading : on ? T.callOn : T.callOff}
          </span>
        </span>
        <Switch on={on === true} />
      </button>
      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-faint)', lineHeight: 1.55 }}>{T.callNeeds}</p>

      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-dim)' }}>{T.ordering}</div>
        <p style={{ margin: '3px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>{T.orderingBody}</p>
      </div>

      {msg && <p role="alert" style={{ margin: 0, fontSize: '0.8rem', color: '#ff6b6b' }}>{msg}</p>}
    </section>
  )
}
