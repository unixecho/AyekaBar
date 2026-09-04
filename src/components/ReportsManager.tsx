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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

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
// 2026-08-16, migration 038: "a sign in option for bartenders and cooks
// and log their sign ins with the shift timeline... a full audit."
interface StationCheckin {
  id: string; staff_id: string; staff_name: string | null
  station: 'bar' | 'kitchen'; event: 'check_in' | 'check_out'; at: string
}

const money = (agorot: number) => `₪${(agorot / 100).toLocaleString('he-IL')}`
const heDateTime = (s: string) => new Date(s).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const heTime = (s: string) => new Date(s).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
const PAGE = 30

export default function ReportsManager() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <NotifyScopeToggle />
      <ShiftPanel />
      <ReceiptsPanel />
    </div>
  )
}

/* ── OMS notification scope ─────────────────────────────────────────
   2026-08-16: "Lets make a way for the owner to choose if all waiters
   get notifications for all tables or table owned notifications so we
   can fit multiple businesses." ayeka-staff's own global ready-alert
   reads this — see its App.tsx. Lives here, not the main dashboard, since
   it's an OMS-operational switch, not a portal-facing one — the other
   toggles on /owner/dashboard all answer "what does a customer see,"
   this one answers "who does a waiter's phone buzz for." */
function NotifyScopeToggle() {
  const [allWaiters, setAllWaiters] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/owner/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setAllWaiters(j.omsNotifyAllWaiters ?? true))
  }, [])

  async function set(next: boolean) {
    setBusy(true); setError(null)
    setAllWaiters(next) // optimistic
    try {
      const res = await fetch('/api/owner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omsNotifyAllWaiters: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setAllWaiters(!next)
      setError('שינוי המצב נכשל. נסה/י שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (allWaiters === null) return null

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>התראות מוכן להגשה</span>
        <div role="group" style={{ display: 'flex', gap: 6 }}>
          <button
            style={allWaiters ? primary : ghost} disabled={busy}
            aria-pressed={allWaiters === true}
            onClick={() => !allWaiters && void set(true)}
          >
            כל המלצרים
          </button>
          <button
            style={!allWaiters ? primary : ghost} disabled={busy}
            aria-pressed={allWaiters === false}
            onClick={() => allWaiters && void set(false)}
          >
            רק בעל/ת השולחן
          </button>
        </div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
        {allWaiters
          ? 'כל מלצר/ית רואה התראת "מוכן להגשה" עבור כל שולחן בקומה.'
          : 'רק המלצר/ית המשויכ/ת לשולחן (או שסימנ/ה את עצמו/ה כאחראי/ת עליו) מקבל/ת את ההתראה.'}
      </p>
      {error && <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#ff6b6b' }}>{error}</p>}
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
            <StationCheckinsList sessionId={active.id} />
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

/** "log their sign ins with the shift timeline and make sure there's a
 *  full audit for it" — 2026-08-16, migration 038. Every bartender/cook
 *  clock-in/out for the currently active session, newest first. Polled,
 *  not just loaded once — this is meant to be glanced at mid-shift, not
 *  only reviewed after the fact. */
function StationCheckinsList({ sessionId }: { sessionId: string }) {
  const [checkins, setCheckins] = useState<StationCheckin[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetch(`/api/owner/shifts?sessionId=${sessionId}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (!cancelled) setCheckins(j.checkins ?? []) })
    void load()
    const id = window.setInterval(load, 20_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [sessionId])

  if (!checkins || checkins.length === 0) return null

  const stationLabel = (s: StationCheckin['station']) => (s === 'bar' ? 'בר' : 'מטבח')

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)' }}>כניסות/יציאות לעמדה</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
        {[...checkins].reverse().map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem' }}>
            <span style={{ color: c.event === 'check_in' ? 'var(--neon)' : 'var(--text-faint)' }}>
              {c.event === 'check_in' ? '↓' : '↑'}
            </span>
            <span style={{ color: 'var(--text)', flex: 1, minWidth: 0 }}>
              {c.staff_name ?? '—'} · {stationLabel(c.station)}
            </span>
            <span style={{ color: 'var(--text-faint)' }}>{heTime(c.at)}</span>
          </div>
        ))}
      </div>
    </div>
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
  // 2026-08-16: "the receipt doesn't show when clicking on it" — couldn't
  // reproduce the failure itself (route + data both check out for real
  // production rows), so this at least stops it from collapsing silently
  // into the generic "not found" copy next time, which told nobody
  // whether the request failed, came back non-ok, or genuinely had no row.
  const [fetchError, setFetchError] = useState<string | null>(null)
  // A11y (WCAG 2.4.3): found 2026-09-04 — this dialog had role="dialog"
  // aria-modal="true" with NEITHER an Escape handler NOR initial-focus
  // management, unlike ConfirmSheet.tsx/PromptSheet.tsx (its siblings in
  // the same "sheet over a scrim" family). A keyboard user could only
  // close it by tabbing all the way to "סגירה".
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => panelRef.current?.focus(), 60)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      window.clearTimeout(timer)
      returnFocusTo.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    setFetchError(null)
    fetch(`/api/owner/reports?id=${id}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => null)
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((j) => { if (!cancelled) setDetail(j) })
      .catch((e) => { if (!cancelled) { setDetail(null); setFetchError(String(e?.message ?? e)) } })
    return () => { cancelled = true }
  }, [id])

  const whose = (i: ReceiptItem, guests: ReceiptGuest[]) => {
    if (i.is_shared) return 'משותף'
    const g = guests.find((x) => x.id === i.guest_id)
    return g ? (g.name?.trim() || `אלמוני ${g.seq}`) : i.seat_name
  }

  // 2026-08-19: "when clicking a on a receipt it shows at the bottom of
  // the page so you have to scroll down to see it." `position:fixed` only
  // escapes to the viewport when NO ancestor establishes its own
  // containing block (a transform/filter/animation on ANY ancestor traps
  // it) — this component used to render as a normal nested child of
  // ReportsManager, three levels under page.tsx's own `.rise` wrapper and
  // template.tsx's page-transition wrapper, either of which (or something
  // added later, by anyone) could become that trap. Rather than keep
  // proving which one (the 2026-08-16 investigation already traced the
  // whole chain once and found nothing conclusive), this renders through
  // a portal straight onto `document.body` — structurally outside every
  // ancestor's DOM subtree, so no ancestor's CSS can ever affect its
  // containing block again, regardless of what changes above it later.
  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label="פרטי קבלה" onClick={onClose}
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
        <div ref={panelRef} tabIndex={-1} style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--line-strong)', borderRadius: 18, overflow: 'hidden', padding: 18, maxHeight: '80vh', overflowY: 'auto' }}>
          {detail === undefined && <div className="sk" style={{ height: 160, borderRadius: 10 }} />}
          {detail === null && (
            <p style={{ color: 'var(--text-dim)', textAlign: 'center' }}>
              הקבלה לא נמצאה{fetchError ? ` (${fetchError})` : ''}.
            </p>
          )}
          {detail && (
            <>
              <div style={{ textAlign: 'center', paddingBottom: 12, marginBottom: 10, borderBottom: '1px dashed var(--line-strong)' }}>
                <b style={{ display: 'block', fontSize: '1rem', color: 'var(--text)' }}>
                  {detail.order.channel === 'quick_purchase' ? 'מכירה מהירה' : `שולחן ${detail.order.table_label ?? detail.order.table_number ?? '—'}`}
                </b>
                <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-dim)' }}>{heDateTime(detail.order.opened_at)} · {detail.order.waiter_name}</span>
              </div>

              {/* 2026-08-19: an order whose items were all voided (e.g. an
                  abandoned table with unaccepted lines — ayeka-staff's own
                  session 7 work the same evening) legitimately has an empty
                  `items` array; that used to render as a blank gap between
                  the header and the total, indistinguishable from "the data
                  didn't load" at a glance. */}
              {detail.items.length === 0 ? (
                <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '10px 0', fontSize: '0.82rem' }}>
                  אין פריטים בקבלה זו.
                </p>
              ) : (
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
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line-strong)', fontWeight: 700, color: 'var(--text)' }}>
                <span>סה״כ</span>
                <span>{money(detail.order.total_agorot)}</span>
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} className="press" style={{ ...ghost, width: '100%', marginTop: 8, textAlign: 'center' }}>סגירה</button>
      </div>
    </div>,
    document.body
  )
}

const card: CSSProperties = { background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 14px', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }
const pointsChip: CSSProperties = { flex: '0 0 auto', background: 'rgba(255,94,58,0.12)', border: '1px solid rgba(255,94,58,0.25)', color: 'var(--neon-soft)', borderRadius: 999, padding: '4px 11px', fontSize: '0.82rem', fontWeight: 700 }
const ghost: CSSProperties = { padding: '8px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--text-dim)', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }
const primary: CSSProperties = { padding: '10px 14px', borderRadius: 10, border: 'none', background: 'var(--neon)', color: '#0b0b0d', fontSize: '0.88rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
