'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MenuCategory } from '@/lib/menu/types'
import { HAPPY_HOUR_DEFAULT, isHappyHourActive, type HappyHour } from '@/lib/menu/variants'
import HappyHourWizard from '@/components/HappyHourWizard'

// The compact happy-hour status card in the editor. Opening it hands the whole
// screen to HappyHourWizard — configuring a discount deserves focus.

const T = {
  title: 'Happy Hour',
  off: 'כבוי',
  onNow: 'פעיל עכשיו',
  scheduled: 'מוגדר',
  setup: 'הגדרה',
  edit: 'עריכה',
  disable: 'כיבוי',
  none: 'אין הנחה מוגדרת.',
  window: (a: string, b: string) => `${a} – ${b}`,
  rules: (n: number) => `${n} קטגוריות/פריטים`,
}

export default function HappyHourCard({ categories }: { categories: MenuCategory[] }) {
  const [hh, setHh] = useState<HappyHour | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Re-render each minute so "פעיל עכשיו" flips at the right time rather than
  // whenever the owner happens to reload.
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/owner/happy-hour', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setHh(j.happyHour)
    } catch {
      setHh(HAPPY_HOUR_DEFAULT)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  async function disable() {
    if (!hh) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/owner/happy-hour', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ happyHour: { ...hh, enabled: false } }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setHh(j.happyHour)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'שמירה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const live = isHappyHourActive(hh)
  const configured = (hh?.rules.length ?? 0) > 0

  return (
    <div style={{
      background: 'var(--bg-elev)',
      border: `1px solid ${live ? 'rgba(255,94,58,0.35)' : 'var(--line)'}`,
      borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'border-color .3s var(--ease)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ fontSize: '1.25rem' }}>🍹</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>{T.title}</span>
            <span style={{
              borderRadius: 999, padding: '2px 9px', fontSize: '0.68rem', fontWeight: 700,
              color: live ? 'var(--neon-soft)' : 'var(--text-faint)',
              background: live ? 'rgba(255,94,58,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${live ? 'rgba(255,94,58,0.3)' : 'var(--line-strong)'}`,
            }}>
              {live ? T.onNow : hh?.enabled ? T.scheduled : T.off}
            </span>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: '3px 0 0' }}>
            {configured && hh
              ? `${T.window(hh.start, hh.end)} · ${T.rules(hh.rules.length)}`
              : T.none}
          </p>
        </div>
      </div>

      {err && <p style={{ color: '#ff6b6b', fontSize: '0.8rem', margin: 0 }}>{err}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setOpen(true)} disabled={busy || hh === null} className="press"
          style={{
            flex: 1, padding: '10px 0', borderRadius: 11, border: 'none',
            background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
            boxShadow: 'var(--glow)', color: '#fff', fontSize: '0.9rem',
            fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
          }}>
          {configured ? T.edit : T.setup}
        </button>
        {hh?.enabled && (
          <button type="button" onClick={disable} disabled={busy} className="press"
            style={{
              padding: '10px 14px', borderRadius: 11, border: '1px solid var(--line-strong)',
              background: 'transparent', color: 'var(--text-dim)', fontSize: '0.86rem',
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}>
            {T.disable}
          </button>
        )}
      </div>

      {open && hh && (
        <HappyHourWizard
          categories={categories}
          initial={hh}
          onClose={() => setOpen(false)}
          onSaved={(next) => { setHh(next); setOpen(false) }}
        />
      )}
    </div>
  )
}
