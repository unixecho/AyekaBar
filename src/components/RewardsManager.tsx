'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import Switch from '@/components/Switch'

interface Reward {
  id: string; reward_name: string | null; reward_name_he: string | null
  required_points: number; active: boolean; created_at: string
}

export default function RewardsManager() {
  const [rewards, setRewards] = useState<Reward[] | null>(null)
  const [nameHe, setNameHe] = useState('')
  const [points, setPoints] = useState('')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/owner/rewards', { cache: 'no-store' })
    const j = await res.json()
    setRewards(j.rewards ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true); setErr(null)
    const res = await fetch('/api/owner/rewards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reward_name_he: nameHe, required_points: Number(points) }),
    })
    const j = await res.json(); setAdding(false)
    if (!res.ok) { setErr(j.error ?? 'שמירה נכשלה'); return }
    setNameHe(''); setPoints(''); await load()
  }

  async function patch(id: string, fields: Partial<Reward>) {
    setBusyId(id)
    const res = await fetch('/api/owner/rewards', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    })
    const j = await res.json(); setBusyId(null)
    if (!res.ok) { setErr(j.error ?? 'עדכון נכשל'); return }
    setErr(null)
    setRewards((cur) => cur?.map((r) => r.id === id ? j.reward : r) ?? cur)
  }

  function askRemove(r: Reward) {
    setConfirmReq({
      title: 'למחוק את הפרס?',
      body: `"${r.reward_name_he ?? r.reward_name ?? ''}" יוסר מהקטלוג ולא יוצג יותר ללקוחות.`,
      confirmLabel: 'מחיקה',
      onConfirm: () => { void remove(r.id) },
    })
  }

  async function remove(id: string) {
    setBusyId(id)
    const res = await fetch('/api/owner/rewards', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    })
    setBusyId(null)
    if (res.ok) setRewards((cur) => cur?.filter((r) => r.id !== id) ?? cur)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>קטלוג פרסים</h2>
      <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', margin: 0 }}>הפרסים שהלקוחות רואים במועדון, לפי כמות נקודות.</p>

      {/* add */}
      <form onSubmit={add} className="rise" style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10, animationDelay: '60ms' }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text)' }}>פרס חדש</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={nameHe} onChange={(e) => setNameHe(e.target.value)} placeholder="שם הפרס" required style={{ ...input, flex: 1 }} />
          <input value={points} onChange={(e) => setPoints(e.target.value)} inputMode="numeric" placeholder="נקודות" dir="ltr" required style={{ ...input, width: 96 }} />
        </div>
        {err && <p style={{ color: '#ff6b6b', fontSize: '0.82rem', margin: 0 }}>{err}</p>}
        <button type="submit" disabled={adding} className="press" style={primary}>{adding ? 'מוסיף…' : 'הוספת פרס'}</button>
      </form>

      {/* list */}
      {rewards === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 62, borderRadius: 12 }} />)}</div>
      ) : rewards.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '14px 0' }}>אין עדיין פרסים.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rewards.map((r, i) => (
            <div key={r.id} className="rise" style={{ ...card, opacity: busyId === r.id ? 0.55 : (r.active ? 1 : 0.6), animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input defaultValue={r.reward_name_he ?? ''} onBlur={(e) => { if (e.target.value.trim() !== (r.reward_name_he ?? '')) patch(r.id, { reward_name_he: e.target.value }) }}
                  style={{ ...input, flex: 1, fontWeight: 600 }} />
                <input defaultValue={String(r.required_points)} onBlur={(e) => { const p = Number(e.target.value); if (p && p !== r.required_points) patch(r.id, { required_points: p }) }}
                  inputMode="numeric" dir="ltr" style={{ ...input, width: 74 }} />
                <span style={{ color: 'var(--neon-soft)', fontWeight: 700, fontSize: '0.85rem' }}>✦</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                <button
                  type="button" role="switch" aria-checked={r.active} className="press"
                  onClick={() => patch(r.id, { active: !r.active })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: 'var(--text-dim)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit' }}
                >
                  פעיל <Switch on={r.active} small />
                </button>
                <button onClick={() => askRemove(r)} className="press" style={{ ...ghost, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)', marginInlineStart: 'auto' }}>מחיקה</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  )
}

const card: CSSProperties = { background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }
const input: CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--bg-elev-2)', color: 'var(--text)', fontSize: '0.92rem', fontFamily: 'inherit', outline: 'none', width: '100%' }
const ghost: CSSProperties = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }
const primary: CSSProperties = { padding: '10px 0', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)', color: 'var(--bg)', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
