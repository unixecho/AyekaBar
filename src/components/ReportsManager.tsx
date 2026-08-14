'use client'

// Receipts + shift info for the owner dashboard (PLAN_OMS_V2.md item 13).
// Johnathan, 2026-08-15: "all receipts need to be easily accessible to the
// owner dashboard along with all shift information." First UI either
// waiter_shift_sessions (migration 034) or an order/receipt view has ever
// had in this repo — see STAFF_APP.md's entry the day this shipped.
//
// Deliberately NOT the full aggregated shift report (revenue-by-category,
// per-staff performance breakdowns) PLAN_OMS_V2.md §13 describes — this is
// the session start/stop + receipts-browser half, which is what was asked
// for. The report-generation half is real, separate follow-up work.

import { useCallback, useEffect, useState, type CSSProperties } from 'react'

interface Receipt {
  id: string
  table_id: string | null
  table_number: number | null
  table_label: string | null
  channel: 'table' | 'quick_purchase'
  status: 'paid' | 'void'
  waiter_name: string
  opened_at: string
  paid_at: string | null
  closed_at: string | null
  bon_at: string | null
  total_agorot: number
}
interface ReceiptItem {
  id: string; item_uid: string; name_he: string; variant: string | null
  unit_agorot: number; qty: number; note: string | null
  category_title: string | null; status: string
  guest_id: string | null; is_shared: boolean; seat_name: string | null
  station: 'bar' | 'kitchen' | null
}
interface ReceiptGuest { id: string; seq: number; name: string | null }
interface ReceiptDetail { order: Receipt; items: ReceiptItem[]; guests: ReceiptGuest[] }

interface ShiftSession {
  id: string; started_at: string; started_by: string | null; started_by_name: string | null
  ended_at: string | null; ended_by: string | null; ended_by_name: string | null
  status: 'active' | 'closed'
}

const money = (agorot: number) => `₪${(agorot / 100).toLocaleString('he-IL')}`
const heDateTime = (s: string) => new Date(s).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const PAGE = 30

export default function ReportsManager() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <ShiftPanel />
      <ReceiptsPanel />
    </div>
  )
}

/* ── Shifts ──────────────────────────────────────────────────────────── */

function ShiftPanel() {
  const [sessions, setSessions] = useState<ShiftSession[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/owner/shifts', { cache: 'no-store' })
    const j = await res.json()
    setSessions(j.sessions ?? [])
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(action: 'start' | 'end') {
    setBusy(true); setError(null)
    const res = await fetch('/api/owner/shifts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    })
    const j = await res.json()
    setBusy(false)
    if (!res.ok) { setError(j.error ?? 'הפעולה נכשלה'); return }
    await load()
  }

  const active = sessions?.find((s) => s.status === 'active') ?? null
  const past = (sessions ?? []).filter((s) => s.status !== 'active').slice(0, 8)

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>משמרות</h2>

      <div style={{ ...card, borderColor: active ? 'var(--neon)' : 'var(--line)' }}>
        {sessions === null ? (
          <div className="sk" style={{ height: 20, borderRadius: 6 }} />
        ) : active ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--neon)' }} />
              <b style={{ color: 'var(--text)' }}>משמרת פעילה</b>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>
                מ־{heDateTime(active.started_at)}{active.started_by_name && ` · ${active.started_by_name}`}
              </span>
            </div>
            <button className="press" disabled={busy} onClick={() => void act('end')} style={{ ...ghost, marginTop: 10 }}>
              {busy ? 'סוגר…' : 'סיום משמרת'}
            </button>
          </>
        ) : (
          <>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.88rem' }}>אין משמרת פעילה כרגע.</span>
            <button className="press" disabled={busy} onClick={() => void act('start')} style={{ ...primary, marginTop: 10 }}>
              {busy ? 'פותח…' : 'פתיחת משמרת'}
            </button>
          </>
        )}
        {error && <p style={{ color: '#ff6b6b', fontSize: '0.8rem', marginTop: 8 }}>{error}</p>}
      </div>

      {past.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {past.map((s) => (
            <div key={s.id} style={{ ...rowStyle, cursor: 'default' }}>
              <div style={{ minWidth: 0, flex: 1, textAlign: 'start', fontSize: '0.82rem' }}>
                <div style={{ color: 'var(--text)' }}>
                  {heDateTime(s.started_at)} → {s.ended_at ? heDateTime(s.ended_at) : '—'}
                </div>
                <div style={{ color: 'var(--text-faint)' }}>
                  {s.started_by_name ?? '—'}{s.ended_by_name && s.ended_by_name !== s.started_by_name ? ` · ${s.ended_by_name}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ── Receipts ────────────────────────────────────────────────────────── */

function ReceiptsPanel() {
  const [list, setList] = useState<Receipt[] | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async (off: number) => {
    setList(null)
    const res = await fetch(`/api/owner/reports?limit=${PAGE}&offset=${off}`, { cache: 'no-store' })
    const j = await res.json()
    setList(j.receipts ?? []); setTotal(j.total ?? 0)
  }, [])

  useEffect(() => { void load(offset) }, [offset, load])

  const label = (r: Receipt) =>
    r.channel === 'quick_purchase' ? 'מכירה מהירה' : `שולחן ${r.table_label ?? r.table_number ?? '—'}`

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>קבלות</h2>

      {list === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[0, 1, 2].map((i) => <div key={i} className="sk" style={{ height: 56, borderRadius: 12 }} />)}
        </div>
      ) : list.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '18px 0' }}>אין עדיין קבלות.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} className="press" style={rowStyle}>
              <div style={{ minWidth: 0, flex: 1, textAlign: 'start' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>
                  {label(r)}{r.status === 'void' && ' · בוטל'}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-dim)' }}>
                  {r.waiter_name} · {heDateTime(r.closed_at ?? r.opened_at)}
                </div>
              </div>
              <span style={pointsChip}>{money(r.total_agorot)}</span>
            </button>
          ))}
        </div>
      )}

      {total > PAGE && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          <button className="press" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} style={ghost}>הקודם</button>
          <button className="press" disabled={offset + PAGE >= total} onClick={() => setOffset((o) => o + PAGE)} style={ghost}>הבא</button>
        </div>
      )}

      {selected && <ReceiptDetailSheet id={selected} onClose={() => setSelected(null)} />}
    </section>
  )
}

function ReceiptDetailSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ReceiptDetail | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/owner/reports?id=${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setDetail(j) })
      .catch(() => { if (!cancelled) setDetail(null) })
    return () => { cancelled = true }
  }, [id])

  const whose = (i: ReceiptItem, guests: ReceiptGuest[]) => {
    if (i.is_shared) return 'משותף'
    const g = guests.find((x) => x.id === i.guest_id)
    return g ? (g.name?.trim() || `אלמוני ${g.seq}`) : i.seat_name
  }

  return (
    <div
      role="dialog" aria-modal="true" onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: 'fade-in .22s var(--ease)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, padding: '0 10px calc(env(safe-area-inset-bottom) + 10px)', animation: 'sheet-up .34s var(--ease)' }}
      >
        <div style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)', borderRadius: 18, overflow: 'hidden', padding: 18, maxHeight: '80vh', overflowY: 'auto' }}>
          {detail === undefined && <div className="sk" style={{ height: 160, borderRadius: 10 }} />}
          {detail === null && <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>הקבלה לא נמצאה.</p>}
          {detail && (
            <>
              <div style={{ textAlign: 'center', paddingBottom: 12, marginBottom: 10, borderBottom: '1px dashed var(--line-strong)' }}>
                <b style={{ display: 'block', fontSize: '1rem', color: 'var(--text)' }}>
                  {detail.order.channel === 'quick_purchase' ? 'מכירה מהירה' : `שולחן ${detail.order.table_label ?? detail.order.table_number ?? '—'}`}
                </b>
                <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-dim)' }}>{heDateTime(detail.order.opened_at)} · {detail.order.waiter_name}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {detail.items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: 'var(--text-faint)', fontSize: '0.82rem', flex: 'none', paddingTop: 1 }}>{i.qty}×</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: '0.88rem', color: 'var(--text)' }}>{i.name_he}{i.variant && <em style={{ fontStyle: 'normal', color: 'var(--text-dim)' }}> · {i.variant}</em>}</b>
                      {i.note && <small style={{ display: 'block', color: 'var(--neon-soft)', fontSize: '0.76rem' }}>{i.note}</small>}
                      {whose(i, detail.guests) && <small style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-faint)' }}>{whose(i, detail.guests)}</small>}
                    </span>
                    <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text)' }}>{money(i.unit_agorot * i.qty)}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line-strong)', fontWeight: 700, color: 'var(--text)' }}>
                <span>סה״כ</span>
                <span>{money(detail.order.total_agorot)}</span>
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} className="press" style={{ ...ghost, width: '100%', marginTop: 8, textAlign: 'center' }}>סגירה</button>
      </div>
    </div>
  )
}

const card: CSSProperties = { background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 14px', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }
const pointsChip: CSSProperties = { flex: '0 0 auto', background: 'rgba(255,94,58,0.12)', border: '1px solid rgba(255,94,58,0.25)', color: 'var(--neon-soft)', borderRadius: 999, padding: '4px 11px', fontSize: '0.82rem', fontWeight: 700 }
const ghost: CSSProperties = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }
const primary: CSSProperties = { padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--neon)', color: '#0b0b0d', fontSize: '0.88rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
