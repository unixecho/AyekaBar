'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { loc, type MenuCategory } from '@/lib/menu/types'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import VariantWizard from '@/components/VariantWizard'
import Switch from '@/components/Switch'
import TempMenuSheet, { type TempSetting } from '@/components/TempMenuSheet'

// The version row that sits above the editor: one chip per menu version, plus
// an iOS "+" that starts the create-a-version flow.
//
// Tapping a chip makes that version the one customers see. With a single
// version the row still renders (so the "+" is discoverable) but there is
// nothing to choose — matching "if one version only exists it will only show
// that".

interface Variant {
  id: string
  name: { he?: string; en?: string; ar?: string }
  excluded_uids: string[]
  is_default: boolean
  sort_order: number | null
  schedule_enabled: boolean | null
  schedule_days: number[] | null
  schedule_start: string | null
  schedule_end: string | null
  active_until: string | null
  expire_action: 'revert' | 'delete' | null
}

const DAY_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

function scheduleLabel(v: Variant): string | null {
  if (!v.schedule_enabled || !v.schedule_start || !v.schedule_end) return null
  const days = (v.schedule_days ?? []).length
    ? (v.schedule_days ?? []).map((d) => DAY_SHORT[d]).join('׳, ') + '׳'
    : 'כל יום'
  return `${days} · ${v.schedule_start}–${v.schedule_end}`
}

const clockAt = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', weekday: 'short',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

/** "עוד 3:41 · עד ש׳, 04:00" — the countdown answers "is this still on?" at a
 *  glance, the wall time answers "until when?" without doing the sum. */
function tempLabel(v: Variant, nowMs: number): string | null {
  if (!v.active_until) return null
  const left = Date.parse(v.active_until) - nowMs
  if (!Number.isFinite(left) || left <= 0) return null
  const mins = Math.floor(left / 60_000)
  const countdown = `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`
  return `עוד ${countdown} · עד ${clockAt.format(new Date(v.active_until))}`
}

const T = {
  label: 'גרסת התפריט',
  hint: 'הגרסה המסומנת היא זו שהלקוחות רואים.',
  add: 'גרסה חדשה',
  edit: 'עריכת פריטים',
  del: 'מחיקת גרסה',
  delTitle: 'למחוק את הגרסה?',
  delBody: 'התפריט יחזור להציג את התפריט הראשי. הפריטים עצמם לא יימחקו.',
  loadErr: 'טעינת הגרסאות נכשלה.',
  hidden: (n: number) => `${n} פריטים מוסתרים`,
  allItems: 'כל הפריטים',
  defaultNote: 'זהו התפריט הראשי — זה שאליו חוזרים כשתזמון או טיימר נגמרים.',
  renameOnly: 'עריכת התפריט הראשי',
  main: 'ראשי',
  makeMain: 'תפריט ראשי',
  makeMainHint: 'הגרסה הזו תהיה זו שאליה התפריט חוזר תמיד.',
  makeMainOn: 'זהו התפריט הראשי כרגע.',
  makeMainTitle: 'להחליף את התפריט הראשי?',
  makeMainBody: (from: string, to: string) =>
    `“${to}” יהפוך לתפריט הראשי — זה שאליו התפריט חוזר כשטיימר או תזמון נגמרים. “${from}” יישאר ברשימה כגרסה רגילה, ואפשר יהיה להחזיר אותו בכל רגע.`,
  makeMainConfirm: 'החלפה',
  timerStart: 'הפעלה זמנית',
  timerEdit: 'שינוי הטיימר',
  willDelete: 'תימחק בסיום',
  expired: 'הטיימר הסתיים',
  needsMigration: 'תפריט זמני והחלפת תפריט ראשי דורשים הרצת מיגרציה 017 במסד הנתונים.',
}

export default function MenuVersionBar() {
  const [variants, setVariants] = useState<Variant[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [wizard, setWizard] = useState<{ mode: 'create' } | { mode: 'edit'; variant: Variant } | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const [timerFor, setTimerFor] = useState<Variant | null>(null)
  // False when the database predates migration 017. The version bar still
  // works; only the timer and main-menu switches are withheld, because
  // offering a control that can only fail is worse than not offering it.
  const [timersReady, setTimersReady] = useState(true)
  // Drives the countdown. A minute is the right grain — the badge reads in
  // whole minutes, so anything faster would just re-render for nothing.
  const [nowMs, setNowMs] = useState(() => Date.now())

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/menu-variants', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setVariants(j.variants)
      setActiveId(j.activeVariantId)
      setCategories(j.categories ?? [])
      setTimersReady(j.timersReady !== false)
      setErr(null)
    } catch {
      setVariants([])
      setErr(T.loadErr)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  // A finished timer changes what customers see whether or not this tab is
  // open, so once the countdown hits zero the editor refetches rather than
  // sitting there showing a version that is no longer live.
  useEffect(() => {
    const live = variants?.find((v) => v.id === activeId)
    if (!live?.active_until) return
    if (Date.parse(live.active_until) > nowMs) return
    load()
  }, [nowMs, variants, activeId, load])

  async function activate(id: string, temp?: TempSetting) {
    if (id === activeId && !temp) return
    const prev = activeId
    setActiveId(id) // optimistic — the switch should feel instant
    setBusy(true)
    try {
      const res = await fetch('/api/owner/menu-variants', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, activate: true, ...(temp ? { temp } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setErr(null)
      // A timer changes fields the row is rendering (the deadline, the badge),
      // so re-read rather than guessing what the server stored.
      if (temp) await load()
    } catch (e) {
      setActiveId(prev)
      setErr(e instanceof Error ? e.message : 'ההחלפה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  function askMakeMain(v: Variant) {
    const current = variants?.find((x) => x.is_default)
    setConfirmReq({
      title: T.makeMainTitle,
      body: T.makeMainBody(loc(current?.name ?? {}, 'he') || '—', loc(v.name, 'he') || '—'),
      confirmLabel: T.makeMainConfirm,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await fetch('/api/owner/menu-variants', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: v.id, makeDefault: true }),
          })
          if (!res.ok) throw new Error((await res.json()).error)
          await load()
          setErr(null)
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'שינוי התפריט הראשי נכשל')
        } finally {
          setBusy(false)
        }
      },
    })
  }

  function askDelete(v: Variant) {
    setConfirmReq({
      title: T.delTitle,
      body: T.delBody,
      confirmLabel: T.del,
      onConfirm: async () => {
        setBusy(true)
        try {
          const res = await fetch('/api/owner/menu-variants', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: v.id }),
          })
          if (!res.ok) throw new Error((await res.json()).error)
          await load()
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'מחיקה נכשלה')
        } finally {
          setBusy(false)
        }
      },
    })
  }

  const active = variants?.find((v) => v.id === activeId) ?? null

  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
      borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text)' }}>{T.label}</div>
        <p style={{ fontSize: '0.76rem', color: 'var(--text-faint)', margin: '3px 0 0', lineHeight: 1.5 }}>{T.hint}</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {variants === null
          ? <div className="sk" style={{ width: 150, height: 36, borderRadius: 999 }} />
          : variants.map((v) => {
            const on = v.id === activeId
            return (
              <button
                key={v.id} type="button" onClick={() => activate(v.id)} disabled={busy}
                role="radio" aria-checked={on} className="press"
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '9px 14px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${on ? 'var(--neon)' : 'var(--line-strong)'}`,
                  background: on ? 'rgba(255,94,58,0.14)' : 'var(--bg-elev-2)',
                  color: on ? 'var(--text)' : 'var(--text-dim)',
                  boxShadow: on ? 'var(--glow)' : 'none',
                  font: 'inherit', fontSize: '0.88rem', fontWeight: 600,
                  transition: 'background .2s var(--ease), border-color .2s var(--ease)',
                }}
              >
                {on && (
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="var(--neon-soft)"
                    strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                )}
                {loc(v.name, 'he') || '—'}
                {v.is_default && <span className="main-badge">{T.main}</span>}
                {v.active_until && Date.parse(v.active_until) > nowMs && <span aria-hidden>⏳</span>}
              </button>
            )
          })}

        {/* iOS-style add */}
        <button
          type="button" onClick={() => setWizard({ mode: 'create' })} disabled={busy || variants === null}
          aria-label={T.add} title={T.add} className="press"
          style={{
            width: 36, height: 36, borderRadius: 999, display: 'grid', placeItems: 'center',
            border: '1px dashed var(--line-strong)', background: 'transparent',
            color: 'var(--neon-soft)', cursor: 'pointer', flex: '0 0 auto',
          }}
        >
          <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor"
            strokeWidth={2.4} strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* The main version can be renamed and scoped, but never scheduled or
          timed — it's the thing every schedule and timer falls back TO. */}
      {active && active.is_default && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>{T.defaultNote}</span>
          <button type="button" onClick={() => setWizard({ mode: 'edit', variant: active })}
            disabled={busy} className="press" style={{ ...ghost, marginInlineStart: 'auto' }}>
            {T.renameOnly}
          </button>
        </div>
      )}

      {active && !active.is_default && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-faint)' }}>
            {active.excluded_uids.length ? T.hidden(active.excluded_uids.length) : T.allItems}
          </span>
          {scheduleLabel(active) && (
            <span className="temp-badge">⏱ {scheduleLabel(active)}</span>
          )}
          {tempLabel(active, nowMs) && (
            <span className="temp-badge">
              ⏳ {tempLabel(active, nowMs)}
              {active.expire_action === 'delete' ? ` · ${T.willDelete}` : ''}
            </span>
          )}
          {timersReady && (
            <button type="button" onClick={() => setTimerFor(active)} disabled={busy}
              className="press" style={ghost}>
              {active.active_until ? T.timerEdit : T.timerStart}
            </button>
          )}
          <button type="button" onClick={() => setWizard({ mode: 'edit', variant: active })}
            disabled={busy} className="press" style={ghost}>
            {T.edit}
          </button>
          <button type="button" onClick={() => askDelete(active)} disabled={busy} className="press"
            style={{ ...ghost, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.3)', marginInlineStart: 'auto' }}>
            {T.del}
          </button>
        </div>
      )}

      {!timersReady && (
        <p style={{
          margin: 0, padding: '9px 11px', borderRadius: 11,
          background: 'rgba(255,94,58,0.08)', border: '1px solid rgba(255,94,58,0.22)',
          color: 'var(--text-dim)', fontSize: '0.75rem', lineHeight: 1.5,
        }}>{T.needsMigration}</p>
      )}

      {/* Which version is MAIN is a different question from which is on show
          right now, so it gets its own row rather than another chip state. */}
      {active && timersReady && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, paddingTop: 10,
          borderTop: '1px solid var(--line)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text)' }}>{T.makeMain}</div>
            <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
              {active.is_default ? T.makeMainOn : T.makeMainHint}
            </p>
          </div>
          <button type="button" role="switch" aria-checked={active.is_default}
            aria-label={T.makeMain} disabled={busy || active.is_default}
            onClick={() => askMakeMain(active)} className="press"
            style={{
              border: 'none', background: 'none', padding: 0,
              cursor: active.is_default ? 'default' : 'pointer',
            }}>
            <Switch on={active.is_default} />
          </button>
        </div>
      )}

      {err && <p style={{ color: '#ff6b6b', fontSize: '0.8rem', margin: 0 }}>{err}</p>}

      {wizard && (
        <VariantWizard
          categories={categories}
          initialName={wizard.mode === 'edit' ? loc(wizard.variant.name, 'he') : ''}
          initialExcluded={wizard.mode === 'edit' ? wizard.variant.excluded_uids : []}
          initialSchedule={{
            enabled: wizard.mode === 'edit' ? !!wizard.variant.schedule_enabled : false,
            days: wizard.mode === 'edit' ? (wizard.variant.schedule_days ?? []) : [],
            start: (wizard.mode === 'edit' && wizard.variant.schedule_start) || '12:00',
            end: (wizard.mode === 'edit' && wizard.variant.schedule_end) || '17:00',
          }}
          variantId={wizard.mode === 'edit' ? wizard.variant.id : null}
          isDefault={wizard.mode === 'edit' && wizard.variant.is_default}
          timersReady={timersReady}
          onClose={() => setWizard(null)}
          onSaved={async () => { setWizard(null); await load() }}
        />
      )}

      {timerFor && (
        <TempMenuSheet
          variantName={loc(timerFor.name, 'he') || '—'}
          initial={timerFor.active_until
            ? { until: timerFor.active_until, deleteOnExpiry: timerFor.expire_action === 'delete' }
            : null}
          allowClear={!!timerFor.active_until}
          onCancel={() => setTimerFor(null)}
          onConfirm={async (value) => {
            const v = timerFor
            setTimerFor(null)
            await activate(v.id, value)
          }}
          // Dropping the timer keeps the version on show — it just stops being
          // temporary. Anything else would make "cancel the timer" a way to
          // accidentally change the menu.
          onClear={async () => {
            const v = timerFor
            setTimerFor(null)
            setBusy(true)
            try {
              const res = await fetch('/api/owner/menu-variants', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: v.id, activate: true }),
              })
              if (!res.ok) throw new Error((await res.json()).error)
              await load()
              setErr(null)
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'ביטול התזמון נכשל')
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  )
}

const ghost: CSSProperties = {
  padding: '7px 12px', borderRadius: 10, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text-dim)', fontSize: '0.8rem',
  fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
}
