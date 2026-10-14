'use client'

import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import PickerSheet, { type PickerOption } from '@/components/payslips/PickerSheet'
import type { RosterOption } from '@/components/payslips/types'
import { haptic } from '@/lib/haptics'
import {
  PAYSLIP_MAX_BYTES, PAYSLIP_MIME, fmtBytes, periodLabel, previousPeriod, recentPeriods, suggestForFile,
} from '@/lib/payslips/rules'

// The owner's upload screen (2026-10-14) — several payslips at once.
//
// The accountant sends a folder of PDFs, one per person. Typing "who" and "which month" for each is slow and, worse,
// is exactly where a payslip lands under the wrong person — which is itself a privacy breach. So:
//
//   1. choose / drop the files;
//   2. each row is PRE-FILLED from its file name (lib/payslips/rules.ts reads "דנה כהן 09-2026" off a name) — and
//      only when the name is unambiguous. A name that fits two people, or says nothing, is left BLANK;
//   3. the owner looks at every row — employee and month are always shown, never hidden behind a default — fixes
//      what is wrong, and only then presses upload. The button stays off until every row has an employee.
//
// A suggestion is never a decision. The server re-checks everything (the bytes, the person, the month) regardless.
//
// Files go one request each, in order, so one bad file never sinks the rest and a row shows its own result.

type RowState = 'ready' | 'uploading' | 'done' | 'error'
interface Staged {
  key: string
  file: File
  staffId: string | null
  period: string | null
  staffHint: boolean
  periodHint: 'name' | 'default' | null
  state: RowState
  message?: string
}

let counter = 0
const accepted = (f: File) => /\.(pdf|jpe?g|png|webp)$/i.test(f.name) || (PAYSLIP_MIME as readonly string[]).includes(f.type)

export default function PayslipUpload({
  roster, existing, onUploaded,
}: {
  roster: RosterOption[]
  /** `${staffId}|${YYYY-MM-01}` of payslips that already exist — to warn that an upload will be a correction. */
  existing: string[]
  onUploaded: () => void
}) {
  const [rows, setRows] = useState<Staged[]>([])
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [pick, setPick] = useState<{ key: string | 'all'; kind: 'staff' | 'period' } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const have = useMemo(() => new Set(existing), [existing])

  const periods = useMemo(() => recentPeriods(36), [])
  const rosterNames = useMemo(() => roster.map((r) => ({ id: r.id, names: r.names })), [roster])
  const nameOf = (id: string | null) => roster.find((r) => r.id === id)?.name ?? null

  function add(list: FileList | File[]) {
    setSummary(null)
    const fallback = previousPeriod()
    const next: Staged[] = []
    for (const file of Array.from(list)) {
      const key = `f${++counter}`
      if (!accepted(file)) { next.push({ key, file, staffId: null, period: null, staffHint: false, periodHint: null, state: 'error', message: 'סוג הקובץ לא נתמך (PDF או תמונה בלבד)' }); continue }
      if (file.size > PAYSLIP_MAX_BYTES) { next.push({ key, file, staffId: null, period: null, staffHint: false, periodHint: null, state: 'error', message: `הקובץ גדול מדי (${fmtBytes(file.size)}, עד 8MB)` }); continue }
      if (file.size === 0) { next.push({ key, file, staffId: null, period: null, staffHint: false, periodHint: null, state: 'error', message: 'הקובץ ריק' }); continue }
      const s = suggestForFile(file.name, rosterNames)
      next.push({
        key, file, staffId: s.staffId, period: s.period ?? fallback,
        staffHint: !!s.staffId, periodHint: s.period ? 'name' : 'default', state: 'ready',
      })
    }
    setRows((cur) => [...cur, ...next])
  }

  const patch = (key: string, p: Partial<Staged>) => setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)))
  const remove = (key: string) => setRows((cur) => cur.filter((r) => r.key !== key))

  function onDrop(e: DragEvent) {
    e.preventDefault(); setOver(false)
    if (e.dataTransfer.files?.length) add(e.dataTransfer.files)
  }

  // A row that failed on the SERVER (it has a person and a month and passed the client checks) can be retried; one the
  // client itself refused (wrong type, too big, empty) never had a person assigned and stays out.
  const uploadable = rows.filter((r) => (r.state === 'ready' || r.state === 'error') && r.staffId && r.period && accepted(r.file) && r.file.size > 0 && r.file.size <= PAYSLIP_MAX_BYTES)
  const missing = rows.filter((r) => r.state === 'ready' && !r.staffId).length
  const batchKeys = (r: Staged) => (r.staffId && r.period ? `${r.staffId}|${r.period}` : null)
  const dupInBatch = useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of rows) { const k = batchKeys(r); if (k && r.state !== 'done') seen.set(k, (seen.get(k) ?? 0) + 1) }
    return seen
  }, [rows])

  async function upload() {
    if (busy || !uploadable.length || missing) return
    setBusy(true); setSummary(null)
    let ok = 0, bad = 0
    for (const r of uploadable) {
      patch(r.key, { state: 'uploading', message: undefined })
      try {
        const body = new FormData()
        body.append('file', r.file)
        body.append('staffId', r.staffId!)
        body.append('period', r.period!.slice(0, 7))
        const res = await fetch('/api/owner/payslips', { method: 'POST', body })
        const json = await res.json().catch(() => ({})) as { ok?: boolean; message?: string }
        if (res.ok && json.ok) { patch(r.key, { state: 'done' }); ok++ }
        else { patch(r.key, { state: 'error', message: json.message ?? 'ההעלאה נכשלה' }); bad++ }
      } catch {
        patch(r.key, { state: 'error', message: 'אין חיבור. נסו שוב.' }); bad++
      }
    }
    setBusy(false)
    if (ok) {
      haptic('select')
      setRows((cur) => cur.filter((r) => r.state !== 'done'))
      onUploaded()
    }
    setSummary(`${ok ? `הועלו ${ok} תלושים` : 'לא הועלה אף תלוש'}${bad ? ` · ${bad} נכשלו — תקנו ונסו שוב` : '.'}`)
  }

  const staffOptions: PickerOption[] = roster.map((r) => ({ value: r.id, label: r.name, hint: r.linked ? undefined : 'עוד לא מחובר/ת — לא יראה/תראה את התלוש' }))
  const periodOptions: PickerOption[] = periods.map((p) => ({ value: p, label: periodLabel(p) }))
  const current = pick && pick.key !== 'all' ? rows.find((r) => r.key === pick.key) : null

  return (
    <div className="pl-card">
      <div>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text)' }}>העלאת תלושים</h3>
        <p className="pl-lead">אפשר לבחור כמה קבצים יחד. השם של כל קובץ משמש להצעה בלבד — עברו על כל שורה לפני ההעלאה.</p>
      </div>

      <input
        ref={inputRef} type="file" multiple hidden
        accept="application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp"
        onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = '' }}
      />
      <div
        className="pu-drop" data-over={over}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      >
        <button type="button" className="press" onClick={() => inputRef.current?.click()} disabled={busy} style={primary}>
          📁 בחירת קבצים
        </button>
        <div style={{ marginTop: 8 }}>או גררו לכאן — PDF, JPG, PNG או WebP, עד 8MB לקובץ</div>
      </div>

      {rows.length > 0 && (
        <>
          <div className="pl-toolbar">
            <button type="button" className="pl-chip press" onClick={() => setPick({ key: 'all', kind: 'period' })} disabled={busy}>📅 חודש לכל השורות</button>
            <button type="button" className="pl-chip press" onClick={() => { setRows([]); setSummary(null) }} disabled={busy}>ניקוי הרשימה</button>
          </div>

          <ul className="pl-list" aria-label="קבצים להעלאה">
            {rows.map((r) => {
              const k = batchKeys(r)
              const isCorrection = k ? have.has(k) : false
              const dup = k ? (dupInBatch.get(k) ?? 0) > 1 : false
              return (
                <li key={r.key} className="pu-row" data-state={r.state}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div dir="auto" className="pu-name">{r.file.name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)' }}>{fmtBytes(r.file.size)}</div>
                    </div>
                    {r.state !== 'uploading' && (
                      <button type="button" className="pl-iconbtn press" style={{ width: 40, height: 40 }} onClick={() => remove(r.key)} aria-label={`הסרת ${r.file.name} מהרשימה`} disabled={busy}>✕</button>
                    )}
                  </div>

                  {r.state === 'error' && r.message && !(r.staffId && r.period) && (
                    <p role="alert" style={{ margin: 0, fontSize: '0.82rem', color: '#ff6b6b', lineHeight: 1.5 }}>{r.message}</p>
                  )}

                  {(r.state !== 'error' || (r.staffId && r.period)) && (
                    <>
                      <div className="pu-picks">
                        <button type="button" className="pu-pick press" data-empty={!r.staffId} onClick={() => setPick({ key: r.key, kind: 'staff' })} disabled={busy || r.state === 'done'}>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-faint)', fontWeight: 600 }}>עובד/ת</span>
                            {nameOf(r.staffId) ?? 'בחרו עובד/ת'}
                          </span>
                          <span aria-hidden>▾</span>
                        </button>
                        <button type="button" className="pu-pick press" onClick={() => setPick({ key: r.key, kind: 'period' })} disabled={busy || r.state === 'done'}>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-faint)', fontWeight: 600 }}>חודש</span>
                            {r.period ? periodLabel(r.period) : 'בחרו חודש'}
                          </span>
                          <span aria-hidden>▾</span>
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: '0.72rem', color: 'var(--text-faint)' }}>
                        {r.staffHint && r.staffId && <span>✓ העובד/ת הוצע/ה לפי שם הקובץ</span>}
                        {r.periodHint === 'name' && <span>✓ החודש הוצע לפי שם הקובץ</span>}
                        {r.periodHint === 'default' && <span>החודש: ברירת מחדל (החודש שעבר) — ודאו</span>}
                        {isCorrection && <span style={{ color: '#fbbf24' }}>⚠ כבר קיים תלוש לחודש הזה — זה יתווסף כתיקון</span>}
                        {dup && <span style={{ color: '#fbbf24' }}>⚠ יש עוד קובץ באותה העלאה לאותו עובד ולאותו חודש</span>}
                      </div>
                    </>
                  )}

                  {r.state === 'uploading' && <p role="status" style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)' }}>מעלה…</p>}
                  {r.state === 'error' && r.message && r.staffId && r.period && (
                    <p role="alert" style={{ margin: 0, fontSize: '0.82rem', color: '#ff6b6b', lineHeight: 1.5 }}>{r.message}</p>
                  )}
                </li>
              )
            })}
          </ul>

          {missing > 0 && (
            <p role="status" style={{ margin: 0, fontSize: '0.82rem', color: '#fbbf24' }}>
              {missing === 1 ? 'בשורה אחת עדיין לא נבחר/ה עובד/ת.' : `ב-${missing} שורות עדיין לא נבחר/ה עובד/ת.`}
            </p>
          )}
          <button type="button" className="press" onClick={upload} disabled={busy || !uploadable.length || missing > 0}
            style={{ ...primary, opacity: busy || !uploadable.length || missing > 0 ? 0.5 : 1 }}>
            {busy ? 'מעלה…' : `העלאת ${uploadable.length} ${uploadable.length === 1 ? 'תלוש' : 'תלושים'}`}
          </button>
        </>
      )}

      {summary && <p role="status" style={{ margin: 0, fontSize: '0.86rem', fontWeight: 700, color: 'var(--neon-soft)' }}>{summary}</p>}

      <PickerSheet
        open={!!pick && pick.kind === 'staff'} title="לאיזה עובד/ת התלוש?" options={staffOptions}
        value={current?.staffId ?? null}
        onPick={(v) => { if (pick && pick.key !== 'all') patch(pick.key, { staffId: v, staffHint: false }); setPick(null) }}
        onClose={() => setPick(null)}
      />
      <PickerSheet
        open={!!pick && pick.kind === 'period'} title={pick?.key === 'all' ? 'חודש לכל השורות' : 'לאיזה חודש?'} options={periodOptions} searchAbove={99}
        value={current?.period ?? null}
        onPick={(v) => {
          if (pick?.key === 'all') setRows((cur) => cur.map((r) => (r.state === 'done' || r.state === 'uploading' ? r : { ...r, period: v, periodHint: null })))
          else if (pick) patch(pick.key, { period: v, periodHint: null })
          setPick(null)
        }}
        onClose={() => setPick(null)}
      />
    </div>
  )
}

const primary: CSSProperties = {
  minHeight: 48, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)',
  color: 'var(--bg)', fontSize: '1rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
}
