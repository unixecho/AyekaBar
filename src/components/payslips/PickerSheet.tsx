'use client'

import { useId, useMemo, useState, type CSSProperties } from 'react'
import SheetShell from '@/components/cart/SheetShell'

// A pick-one list in the app's own iOS sheet — "never a browser-native select" (CLAUDE.md). Used by the payslip
// upload screen for "which employee" and "which month". A search box appears once the list is long enough to need
// one; the current choice is marked; tapping a row picks it and closes the sheet.

export interface PickerOption { value: string; label: string; hint?: string }

export default function PickerSheet({
  open, title, options, value, onPick, onClose, searchAbove = 8,
}: {
  open: boolean
  title: string
  options: PickerOption[]
  value: string | null
  onPick: (value: string) => void
  onClose: () => void
  /** Show a search box when there are more options than this. */
  searchAbove?: number
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q)) : options
  }, [options, query])

  if (!open) return null
  const close = () => { setQuery(''); onClose() }

  return (
    <SheetShell open onClose={close} dir="rtl" label={title}
      footer={<button type="button" className="press" onClick={close} style={{ ...ghost, marginTop: 12 }}>סגירה</button>}>
      <h2 style={{ margin: '0 0 10px', fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', textAlign: 'start' }}>{title}</h2>
      {options.length > searchAbove && (
        <div style={{ marginBottom: 8 }}>
          <label htmlFor={searchId} className="sr-only" style={srOnly}>חיפוש</label>
          <input
            id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש…"
            autoComplete="off" style={input}
          />
        </div>
      )}
      <div className="sheet-scroll" role="listbox" aria-label={title} style={{ gap: 6 }}>
        {shown.length === 0 && <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem', textAlign: 'center', padding: '14px 0' }}>לא נמצאו תוצאות.</p>}
        {shown.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value} type="button" role="option" aria-selected={on} className="press"
              onClick={() => { setQuery(''); onPick(o.value) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 46, padding: '10px 12px', textAlign: 'start',
                borderRadius: 12, fontFamily: 'inherit', cursor: 'pointer',
                border: `1px solid ${on ? 'var(--neon-soft)' : 'var(--line)'}`,
                background: on ? 'rgba(255,138,92,0.11)' : 'var(--bg)',
                color: on ? 'var(--neon-soft)' : 'var(--text)',
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '0.92rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                {o.hint && <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: 1 }}>{o.hint}</span>}
              </span>
              {on && <span aria-hidden>✓</span>}
            </button>
          )
        })}
      </div>
    </SheetShell>
  )
}

const ghost: CSSProperties = {
  minHeight: 46, width: '100%', padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const input: CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line-strong)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: '0.95rem', fontFamily: 'inherit', outline: 'none',
}
const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
