'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import ConfirmSheet, { type ConfirmRequest } from '@/components/ConfirmSheet'
import PayslipViewer from '@/components/payslips/PayslipViewer'
import PayslipUpload from '@/components/payslips/PayslipUpload'
import PickerSheet, { type PickerOption } from '@/components/payslips/PickerSheet'
import type { PayslipItem, RosterOption } from '@/components/payslips/types'
import { haptic } from '@/lib/haptics'
import { ZIP_MAX_FILES, fmtBytes, groupByYear, periodLabel } from '@/lib/payslips/rules'
import '@/components/payslips/payslips.css'

// The payslip library (2026-10-14) — ONE component for both audiences:
//
//   mode "own"  /staff/payslips   an employee's own payslips: read them in the viewer, download one or many.
//   mode "all"  /owner/payslips   the owner: everyone's, filtered by person and year, plus the upload screen and removal.
//
// WHAT THE OWNER ASKED FOR (2026-10-14): "a viewing port for watching payslips without having to download them
// individually, [and] multiple downloads at once as a zip." Hence two things on every list:
//
//   • tap a row → the viewer opens IN the page, with previous/next, so reading a year is twelve taps and no downloads;
//   • "בחירה" → tick any number of rows → "הורדה כ-ZIP" → one file.
//
// The page decides WHICH payslips this component is given (an employee's page only ever queries their own; see
// lib/payslips/server.ts) — this component never widens that, and the routes it calls re-check on every request.
//
// Passwords for locked PDFs live in this component's memory only (a ref-like state): never storage, never a request.

const DATE = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' })

export default function PayslipLibrary({
  mode, items, roster, notSetUp, failed,
}: {
  mode: 'own' | 'all'
  items: PayslipItem[]
  /** Owner only. */
  roster: RosterOption[]
  notSetUp: boolean
  failed: boolean
}) {
  const router = useRouter()
  const [staffFilter, setStaffFilter] = useState<string | null>(null)
  const [year, setYear] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [viewId, setViewId] = useState<string | null>(null)
  const [pickStaff, setPickStaff] = useState(false)
  const [zipBusy, setZipBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const [passwords, setPasswords] = useState<Record<string, string>>({})

  const years = useMemo(() => Array.from(new Set(items.map((i) => i.period.slice(0, 4)))).sort().reverse(), [items])
  const people = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of items) m.set(i.staff_id, i.staffName)
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'he'))
  }, [items])

  const visible = useMemo(
    () => items.filter((i) => (!staffFilter || i.staff_id === staffFilter) && (!year || i.period.startsWith(year))),
    [items, staffFilter, year])
  const groups = useMemo(() => groupByYear(visible), [visible])
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const viewIndex = viewId ? flat.findIndex((i) => i.id === viewId) : -1

  const unseen = mode === 'all' ? items.filter((i) => !i.employee_first_viewed_at).length : 0
  const existing = useMemo(() => items.map((i) => `${i.staff_id}|${i.period}`), [items])

  const toggle = useCallback((id: string) => {
    setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }, [])

  function exitSelect() { setSelectMode(false); setSelected(new Set()) }

  function selectAll() {
    haptic('select')
    const ids = flat.map((i) => i.id)
    if (ids.length > ZIP_MAX_FILES) setNotice({ kind: 'ok', text: `נבחרו ${ZIP_MAX_FILES} הראשונים — זה המקסימום להורדה אחת.` })
    setSelected(new Set(ids.slice(0, ZIP_MAX_FILES)))
  }

  async function downloadZip() {
    const ids = Array.from(selected)
    if (!ids.length || zipBusy) return
    setZipBusy(true); setNotice(null)
    try {
      const qs = `ids=${ids.map(encodeURIComponent).join(',')}`
      // Ask first, so a refusal is a sentence here and not a JSON page where the download should have been.
      const check = await fetch(`/api/payslips/zip?${qs}&check=1`, { cache: 'no-store' })
      const json = await check.json().catch(() => ({})) as { ok?: boolean; error?: string; files?: number; bytes?: number }
      if (!check.ok || !json.ok) { setNotice({ kind: 'err', text: json.error ?? 'ההורדה נכשלה. נסו שוב.' }); return }
      const a = document.createElement('a')
      a.href = `/api/payslips/zip?${qs}`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      haptic('impact')
      setNotice({ kind: 'ok', text: `ההורדה התחילה — ${json.files} קבצים (${fmtBytes(json.bytes ?? 0)}).` })
    } catch {
      setNotice({ kind: 'err', text: 'אין חיבור. נסו שוב.' })
    } finally {
      setZipBusy(false)
    }
  }

  function askRemove(item: PayslipItem) {
    setConfirmReq({
      title: 'להסיר את התלוש?',
      body: `${periodLabel(item.period)} · ${item.staffName}. הקובץ יימחק מהאחסון ולא יהיה אפשר לשחזר אותו. אם הועלה לאדם הלא נכון — זו הפעולה הנכונה; אחר כך מעלים אותו מחדש.`,
      confirmLabel: 'הסרה ומחיקת הקובץ',
      onConfirm: () => { void remove(item) },
    })
  }

  async function remove(item: PayslipItem) {
    try {
      const res = await fetch('/api/owner/payslips', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }),
      })
      const json = await res.json().catch(() => ({})) as { ok?: boolean; message?: string }
      if (!res.ok || !json.ok) throw new Error(json.message ?? 'ההסרה נכשלה')
      // Land on the neighbour (or close) before the list refreshes underneath the viewer.
      const i = flat.findIndex((x) => x.id === item.id)
      const next = flat[i + 1] ?? flat[i - 1] ?? null
      setViewId(next && next.id !== item.id ? next.id : null)
      setSelected((cur) => { const n = new Set(cur); n.delete(item.id); return n })
      setNotice({ kind: 'ok', text: json.message ?? 'התלוש הוסר והקובץ נמחק.' })
      router.refresh()
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'ההסרה נכשלה' })
    }
  }

  const staffOptions: PickerOption[] = [
    { value: '', label: 'כל העובדים' },
    ...people.map(([id, name]) => ({ value: id, label: name })),
  ]

  return (
    <div className="pl-wrap">
      <div>
        <h2 className="pl-h2">{mode === 'all' ? 'תלושי שכר' : 'התלושים שלי'}</h2>
        <p className="pl-lead">
          {mode === 'all'
            ? 'העלו תלושים, קראו אותם כאן בלי להוריד אחד-אחד, והורידו כל בחירה כקובץ ZIP אחד. כל עובד/ת רואה רק את התלושים שלו/ה.'
            : 'הקישו על תלוש כדי לקרוא אותו כאן, בלי להוריד. אפשר גם לבחור כמה תלושים ולהוריד אותם יחד כקובץ ZIP אחד.'}
        </p>
      </div>

      {notSetUp && (
        <p role="status" className="pl-card" style={{ margin: 0, color: '#fbbf24', fontSize: '0.88rem', lineHeight: 1.6 }}>
          ספריית התלושים עדיין לא הופעלה במערכת. כשתופעל, התלושים יופיעו כאן.
        </p>
      )}
      {failed && <p role="alert" style={{ margin: 0, color: '#ff6b6b', fontSize: '0.88rem' }}>טעינת התלושים נכשלה. נסו לרענן.</p>}

      {mode === 'all' && !notSetUp && (
        <PayslipUpload roster={roster} existing={existing} onUploaded={() => router.refresh()} />
      )}

      {notice && (
        <p role={notice.kind === 'err' ? 'alert' : 'status'} style={{ margin: 0, fontSize: '0.86rem', fontWeight: 600, lineHeight: 1.5, color: notice.kind === 'err' ? '#ff6b6b' : 'var(--neon-soft)' }}>
          {notice.text}
        </p>
      )}

      {!notSetUp && !failed && items.length === 0 && (
        <div className="pl-card" style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.9rem', lineHeight: 1.7 }}>
          <div aria-hidden style={{ fontSize: '1.8rem' }}>📄</div>
          {mode === 'all' ? 'עדיין לא הועלו תלושים. התחילו בהעלאה למעלה.' : 'עדיין אין כאן תלושים. כשהבעלים יעלה אותם, הם יופיעו כאן.'}
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className="pl-toolbar" role="group" aria-label="סינון ובחירה">
            {mode === 'all' && people.length > 1 && (
              <button type="button" className="pl-chip press" data-on={!!staffFilter} onClick={() => setPickStaff(true)}>
                👤 {staffFilter ? people.find(([id]) => id === staffFilter)?.[1] : 'כל העובדים'} ▾
              </button>
            )}
            {years.length > 1 && (
              <>
                <button type="button" className="pl-chip press" aria-pressed={!year} onClick={() => setYear(null)}>כל השנים</button>
                {years.map((y) => (
                  <button key={y} type="button" className="pl-chip press" aria-pressed={year === y} onClick={() => setYear(year === y ? null : y)}>{y}</button>
                ))}
              </>
            )}
            <button type="button" className="pl-chip press" aria-pressed={selectMode} style={{ marginInlineStart: 'auto' }}
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
              {selectMode ? 'סיום בחירה' : '☑︎ בחירה להורדה'}
            </button>
          </div>

          {mode === 'all' && unseen > 0 && (
            <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-faint)' }}>{unseen} מהתלושים עדיין לא נפתחו על ידי העובדים.</p>
          )}

          {visible.length === 0 && (
            <p style={{ color: 'var(--text-faint)', fontSize: '0.86rem', textAlign: 'center', padding: '14px 0' }}>אין תלושים בסינון הזה.</p>
          )}

          {groups.map((g) => (
            <section key={g.year} aria-label={`שנת ${g.year}`}>
              <div className="pl-group-h">
                <h3>{g.year}</h3>
                <span className="pl-count">{g.rows.length}</span>
                {selectMode && (
                  <button type="button" className="pl-chip press" style={{ marginInlineStart: 'auto', minHeight: 34 }}
                    onClick={() => {
                      const ids = g.rows.map((r) => r.id)
                      const all = ids.every((id) => selected.has(id))
                      setSelected((cur) => { const n = new Set(cur); ids.forEach((id) => (all ? n.delete(id) : n.add(id))); return n })
                    }}>
                    {g.rows.every((r) => selected.has(r.id)) ? 'ביטול הבחירה' : 'בחירת השנה'}
                  </button>
                )}
              </div>
              <ul className="pl-list">
                {g.rows.map((it) => {
                  const on = selected.has(it.id)
                  const unread = !it.employee_first_viewed_at
                  return (
                    <li key={it.id} className="pl-row" data-selected={selectMode && on}>
                      {selectMode && (
                        <button type="button" role="checkbox" aria-checked={on} className="pl-check press"
                          aria-label={`בחירת ${periodLabel(it.period)}${mode === 'all' ? ` של ${it.staffName}` : ''}`}
                          onClick={() => toggle(it.id)}>{on ? '✓' : ''}</button>
                      )}
                      <button type="button" className="pl-open" onClick={() => (selectMode ? toggle(it.id) : setViewId(it.id))}>
                        <span className="pl-month">{periodLabel(it.period)}</span>
                        <span className="pl-meta">
                          {mode === 'all' ? `${it.staffName} · ` : ''}{it.file_mime === 'application/pdf' ? 'PDF' : 'תמונה'} · {fmtBytes(it.file_bytes)} · הועלה {DATE.format(new Date(it.uploaded_at))}
                        </span>
                      </button>
                      {mode === 'own' && unread && <span className="pl-badge">חדש</span>}
                      {mode === 'all' && unread && <span className="pl-badge" data-quiet="true">טרם נצפה</span>}
                      {!selectMode && (
                        <a className="pl-iconbtn press" href={`/api/payslips/file?id=${encodeURIComponent(it.id)}&download=1`} aria-label={`הורדת ${periodLabel(it.period)}${mode === 'all' ? ` של ${it.staffName}` : ''}`}>⬇</a>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}

          {selectMode && (
            <div className="pl-bar" role="region" aria-label="הורדת הבחירה">
              <strong>{selected.size === 0 ? 'לא נבחרו תלושים' : `נבחרו ${selected.size}`}</strong>
              <button type="button" className="pl-chip press" onClick={selectAll} disabled={zipBusy}>בחירת הכל</button>
              <button type="button" className="pl-chip press" onClick={() => setSelected(new Set())} disabled={zipBusy || selected.size === 0}>ניקוי</button>
              <button type="button" className="press" onClick={downloadZip} disabled={zipBusy || selected.size === 0}
                style={{
                  minHeight: 44, padding: '0 18px', borderRadius: 12, border: 'none', fontFamily: 'inherit', cursor: 'pointer',
                  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', color: 'var(--bg)', fontSize: '0.95rem', fontWeight: 800,
                  opacity: zipBusy || selected.size === 0 ? 0.5 : 1,
                }}>
                {zipBusy ? 'מכין…' : '⬇ הורדה כ-ZIP'}
              </button>
            </div>
          )}
        </>
      )}

      {viewIndex >= 0 && (
        <PayslipViewer
          items={flat} index={viewIndex} mode={mode}
          onIndex={(i) => setViewId(flat[i]?.id ?? null)}
          onClose={() => setViewId(null)}
          onAskRemove={mode === 'all' ? askRemove : undefined}
          suspended={!!confirmReq}
          passwords={passwords}
          onPassword={(staffId, pw) => setPasswords((cur) => (cur[staffId] === pw ? cur : { ...cur, [staffId]: pw }))}
        />
      )}

      <PickerSheet
        open={pickStaff} title="סינון לפי עובד/ת" options={staffOptions} value={staffFilter ?? ''}
        onPick={(v) => { setStaffFilter(v || null); setPickStaff(false) }}
        onClose={() => setPickStaff(false)}
      />
      <ConfirmSheet request={confirmReq} onClose={() => setConfirmReq(null)} />
    </div>
  )
}
