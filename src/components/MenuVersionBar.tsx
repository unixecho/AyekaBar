'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { loc, type MenuCategory } from '@/lib/menu/types'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import VariantWizard from '@/components/VariantWizard'

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
}

const DAY_SHORT = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש']

function scheduleLabel(v: Variant): string | null {
  if (!v.schedule_enabled || !v.schedule_start || !v.schedule_end) return null
  const days = (v.schedule_days ?? []).length
    ? (v.schedule_days ?? []).map((d) => DAY_SHORT[d]).join('׳, ') + '׳'
    : 'כל יום'
  return `${days} · ${v.schedule_start}–${v.schedule_end}`
}

const T = {
  label: 'גרסת התפריט',
  hint: 'הגרסה המסומנת היא זו שהלקוחות רואים.',
  add: 'גרסה חדשה',
  edit: 'עריכת פריטים',
  del: 'מחיקת גרסה',
  delTitle: 'למחוק את הגרסה?',
  delBody: 'התפריט יחזור להציג את הגרסה הרגילה. הפריטים עצמם לא יימחקו.',
  loadErr: 'טעינת הגרסאות נכשלה.',
  hidden: (n: number) => `${n} פריטים מוסתרים`,
  allItems: 'כל הפריטים',
  defaultNote: 'הגרסה המלאה — כל הפריטים, וזו שאליה חוזרים כשתזמון נגמר.',
  renameOnly: 'שינוי שם',
}

export default function MenuVersionBar() {
  const [variants, setVariants] = useState<Variant[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [wizard, setWizard] = useState<{ mode: 'create' } | { mode: 'edit'; variant: Variant } | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/menu-variants', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setVariants(j.variants)
      setActiveId(j.activeVariantId)
      setCategories(j.categories ?? [])
      setErr(null)
    } catch {
      setVariants([])
      setErr(T.loadErr)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function activate(id: string) {
    if (id === activeId) return
    const prev = activeId
    setActiveId(id) // optimistic — the switch should feel instant
    setBusy(true)
    try {
      const res = await fetch('/api/owner/menu-variants', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, activate: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setErr(null)
    } catch (e) {
      setActiveId(prev)
      setErr(e instanceof Error ? e.message : 'ההחלפה נכשלה')
    } finally {
      setBusy(false)
    }
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

      {/* The default can be renamed but not scoped or scheduled — it IS the
          full menu and the fallback everything else reverts to. */}
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
            <span style={{
              fontSize: '0.72rem', fontWeight: 700, color: 'var(--neon-soft)',
              border: '1px solid rgba(255,94,58,0.3)', background: 'rgba(255,94,58,0.10)',
              borderRadius: 999, padding: '2px 9px',
            }}>⏱ {scheduleLabel(active)}</span>
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
          onClose={() => setWizard(null)}
          onSaved={async () => { setWizard(null); await load() }}
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
