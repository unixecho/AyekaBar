'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

interface Customer {
  id: string; first_name: string | null; last_name: string | null
  email: string | null; phone: string | null
  points: number; total_visits: number; last_visit_at: string | null; created_at: string
}

const custName = (c: { first_name: string | null; last_name: string | null }) =>
  [c.first_name, c.last_name].filter(Boolean).join(' ')
interface Stats { customers: number; points_outstanding: number; visits_today: number; new_this_week: number }
interface Detail {
  customer: Customer
  visits: { id: string; points_awarded: number; visit_timestamp: string }[]
  redemptions: { id: string; points_deducted: number; redeemed_at: string; reward_id: string }[]
  adjustments: { id: string; delta: number; reason: string | null; created_at: string }[]
}

const PAGE = 25
const heDate = (s: string | null) => s ? new Date(s).toLocaleDateString('he-IL') : '—'
const heDateTime = (s: string) => new Date(s).toLocaleString('he-IL')

export default function CustomerManager() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [list, setList] = useState<Customer[] | null>(null)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/owner/customers?stats=1').then((r) => r.json()).then((j) => setStats(j.stats)).catch(() => {})
  }, [])

  const loadList = useCallback(async (query: string, off: number) => {
    setList(null)
    const params = new URLSearchParams({ q: query, limit: String(PAGE), offset: String(off) })
    const res = await fetch(`/api/owner/customers?${params}`, { cache: 'no-store' })
    const j = await res.json()
    setList(j.customers ?? []); setTotal(j.total ?? 0)
  }, [])

  // debounced search + pagination
  useEffect(() => {
    const t = setTimeout(() => loadList(q, offset), 250)
    return () => clearTimeout(t)
  }, [q, offset, loadList])

  if (selected) return <CustomerDetail id={selected} onBack={() => { setSelected(null); loadList(q, offset) }} onStats={setStats} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>לקוחות ונקודות</h2>
        <a href="/api/owner/customers?export=csv" className="press" style={{ ...ghost, textDecoration: 'none' }}>⬇ ייצוא CSV</a>
      </div>

      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        <StatTile label="לקוחות" value={stats?.customers} delay={0} />
        <StatTile label="נקודות פעילות" value={stats?.points_outstanding} accent delay={40} />
        <StatTile label="ביקורים היום" value={stats?.visits_today} delay={80} />
        <StatTile label="חדשים השבוע" value={stats?.new_this_week} delay={120} />
      </div>

      {/* search */}
      <input value={q} onChange={(e) => { setOffset(0); setQ(e.target.value) }} placeholder="חיפוש לפי שם, אימייל או טלפון…" aria-label="חיפוש לקוחות לפי שם, אימייל או טלפון" type="search" className="rise" style={{ ...input, animationDelay: '150ms' }} />

      {/* list */}
      {list === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 60, borderRadius: 12 }} />)}</div>
      ) : list.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '18px 0' }}>לא נמצאו לקוחות.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((c, i) => (
            <button key={c.id} onClick={() => setSelected(c.id)} className="press rise" style={{ ...rowStyle, animationDelay: `${Math.min(i, 8) * 35}ms` }}>
              <div style={{ minWidth: 0, flex: 1, textAlign: 'start' }}>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{custName(c) || c.email || c.phone || '—'}</div>
                {custName(c) && <div dir="ltr" style={{ fontSize: '0.76rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>{c.email ?? c.phone}</div>}
                <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{c.total_visits} ביקורים · {heDate(c.last_visit_at)}</div>
              </div>
              <span style={pointsChip}>{c.points} ✦</span>
            </button>
          ))}
        </div>
      )}

      {/* pagination */}
      {total > PAGE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="press" style={{ ...ghost, opacity: offset === 0 ? 0.4 : 1 }}>הקודם</button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-faint)' }}>{offset + 1}–{Math.min(offset + PAGE, total)} מתוך {total}</span>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className="press" style={{ ...ghost, opacity: offset + PAGE >= total ? 0.4 : 1 }}>הבא</button>
        </div>
      )}
    </div>
  )
}

function CustomerDetail({ id, onBack, onStats }: { id: string; onBack: () => void; onStats: (s: Stats) => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/owner/customers?id=${id}`, { cache: 'no-store' })
    setD(await res.json())
  }, [id])
  useEffect(() => { load() }, [load])

  async function adjust(sign: 1 | -1) {
    const n = Math.trunc(Number(delta))
    if (!Number.isFinite(n) || n <= 0) { setMsg('הזן מספר חיובי'); return }
    setBusy(true); setMsg(null)
    const res = await fetch('/api/owner/customers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: id, delta: sign * n, reason }),
    })
    const j = await res.json()
    setBusy(false)
    if (!res.ok) { setMsg(j.error ?? 'העדכון נכשל'); return }
    setDelta(''); setReason(''); setMsg('עודכן ✓')
    await load()
    fetch('/api/owner/customers?stats=1').then((r) => r.json()).then((s) => s.stats && onStats(s.stats)).catch(() => {})
    setTimeout(() => setMsg(null), 2000)
  }

  if (!d) return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 54, borderRadius: 12 }} />)}</div>
  const c = d.customer

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onBack} className="press rise" style={{ ...ghost, alignSelf: 'flex-start' }}>← חזרה לרשימה</button>

      <div className="rise" style={{ ...card, animationDelay: '50ms' }}>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>{custName(c) || c.email || '—'}</div>
        {custName(c) && c.email && <div dir="ltr" style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textAlign: 'start' }}>{c.email}</div>}
        {c.phone && <div dir="ltr" style={{ fontSize: '0.85rem', color: 'var(--text-dim)', textAlign: 'start' }}>{c.phone}</div>}
        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <Stat label="נקודות" value={c.points} accent />
          <Stat label="ביקורים" value={c.total_visits} />
          <Stat label="חבר מאז" value={heDate(c.created_at)} />
        </div>
      </div>

      {/* adjust */}
      <div className="rise" style={{ ...card, animationDelay: '100ms' }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)', marginBottom: 8 }}>עדכון נקודות ידני</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="numeric" placeholder="כמות" aria-label="כמות נקודות לעדכון" dir="ltr" style={{ ...input, width: 90 }} />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="סיבה (רשות)" aria-label="סיבה (רשות)" style={{ ...input, flex: 1 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => adjust(1)} disabled={busy} className="press" style={{ ...primary, flex: 1 }}>＋ הוספה</button>
          <button onClick={() => adjust(-1)} disabled={busy} className="press" style={{ ...danger, flex: 1 }}>－ הפחתה</button>
        </div>
        {msg && <p style={{ fontSize: '0.82rem', color: msg.includes('✓') ? 'var(--neon-soft)' : '#ff6b6b', margin: '8px 0 0' }}>{msg}</p>}
      </div>

      <HistoryBlock delay={150} title="עדכונים ידניים" empty="אין עדכונים" rows={d.adjustments.map((a) => ({ id: a.id, left: `${a.delta > 0 ? '+' : ''}${a.delta} ✦`, right: `${heDateTime(a.created_at)}${a.reason ? ' · ' + a.reason : ''}`, accent: a.delta > 0 }))} />
      <HistoryBlock delay={190} title="ביקורים אחרונים" empty="אין ביקורים" rows={d.visits.map((v) => ({ id: v.id, left: `+${v.points_awarded} ✦`, right: heDateTime(v.visit_timestamp), accent: true }))} />
      {d.redemptions.length > 0 && (
        <HistoryBlock delay={230} title="מימושים" empty="" rows={d.redemptions.map((r) => ({ id: r.id, left: `-${r.points_deducted} ✦`, right: heDateTime(r.redeemed_at), accent: false }))} />
      )}
    </div>
  )
}

function HistoryBlock({ title, empty, rows, delay }: { title: string; empty: string; rows: { id: string; left: string; right: string; accent: boolean }[]; delay: number }) {
  return (
    <div className="rise" style={{ animationDelay: `${delay}ms` }}>
      <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 8px' }}>{title}</h3>
      {rows.length === 0 ? <p style={{ fontSize: '0.82rem', color: 'var(--text-faint)', margin: 0 }}>{empty}</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '9px 12px' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{r.right}</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: r.accent ? 'var(--neon-soft)' : 'var(--text-faint)' }}>{r.left}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StatTile({ label, value, accent, delay }: { label: string; value?: number; accent?: boolean; delay: number }) {
  return (
    <div className="rise" style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', animationDelay: `${delay}ms` }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: accent ? 'var(--neon-soft)' : 'var(--text)' }}>{value ?? '—'}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: 2 }}>{label}</div>
    </div>
  )
}
function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: '1.15rem', fontWeight: 800, color: accent ? 'var(--neon-soft)' : 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{label}</div>
    </div>
  )
}

const card: CSSProperties = { background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 14px', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }
const pointsChip: CSSProperties = { flex: '0 0 auto', background: 'rgba(255,94,58,0.12)', border: '1px solid rgba(255,94,58,0.25)', color: 'var(--neon-soft)', borderRadius: 999, padding: '4px 11px', fontSize: '0.82rem', fontWeight: 700 }
const input: CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)', color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none', width: '100%' }
const ghost: CSSProperties = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }
const primary: CSSProperties = { padding: '10px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)', color: 'var(--bg)', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
const danger: CSSProperties = { padding: '10px 0', borderRadius: 10, border: '1px solid rgba(255,107,107,0.4)', background: 'transparent', color: '#ff6b6b', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
