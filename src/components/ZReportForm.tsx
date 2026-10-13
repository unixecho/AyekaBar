'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { haptic } from '@/lib/haptics'
import { Z_MAX_BYTES, Z_NOTE_MAX } from '@/lib/zreport/rules'

// The Z-report upload (staff, Hebrew only). Shown only inside the 23:00 window
// to someone allowed to file — but that is courtesy: POST /api/zreport re-checks
// both against the server's clock and refuses otherwise.
//
// A PHONE-FIRST FORM. The person using it is a shift manager standing at the
// till at midnight with a paper slip and a phone, so the first thing offered is
// the camera. Photos from a modern phone are 3–8 MB; the browser shrinks them
// before sending (a Z slip is black text on white — 2000px is plenty to read,
// and it keeps the upload fast on bar Wi-Fi). If the shrink cannot run, the
// original is sent and the server's own size and type checks have the last word.

const MAX_EDGE = 2000
const SKIP_COMPRESS_BELOW = 1_200_000

/** Re-encode an image as a ≤2000px JPEG. Returns the original on any failure. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < SKIP_COMPRESS_BELOW) return file
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) // a transparent PNG must not turn black as a JPEG
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

const fmtSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`)

export interface ExistingReport {
  uploadedAt: string
  uploadedByName: string
  totalLabel: string | null
}

export default function ZReportForm({
  businessDateLabel, existing, notSetUp,
}: {
  /** "יום שלישי, 13.10" — the night this report closes. */
  businessDateLabel: string
  existing: ExistingReport | null
  /** Migration 056 not applied — the form is shown disabled with a reason. */
  notSetUp: boolean
}) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [total, setTotal] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const totalId = useId()
  const noteId = useId()
  const errId = useId()

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(null); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function choose(f: File | null) {
    setError(null)
    if (f && f.size > Z_MAX_BYTES * 4) { setError('הקובץ גדול מדי.'); return }
    setFile(f)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || busy || notSetUp) return
    setBusy(true); setError(null)
    try {
      const body = new FormData()
      body.append('file', await shrink(file))
      if (total.trim()) body.append('total', total.trim())
      if (note.trim()) body.append('note', note.trim())
      const res = await fetch('/api/zreport', { method: 'POST', body })
      const json = await res.json().catch(() => ({})) as { ok?: boolean; message?: string }
      if (!res.ok || !json.ok) { setError(json.message ?? 'ההעלאה נכשלה. נסו שוב.'); return }
      haptic('select')
      setDone(true)
    } catch {
      setError('אין חיבור. נסו שוב.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div role="status" className="rise" style={{ ...card, textAlign: 'center', gap: 10 }}>
        <div aria-hidden style={{ fontSize: '2rem' }}>✅</div>
        <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>הדוח הועלה</p>
        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          דוח Z של {businessDateLabel} נשמר ויופיע אצל הבעלים. תודה ולילה טוב!
        </p>
        <Link href="/staff/dashboard" className="press" style={primaryLink}>חזרה ללוח שלי</Link>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="rise" style={card} noValidate>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)' }}>דוח Z — {businessDateLabel}</h2>
        <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>
          צלמו או העלו את דוח הסגירה של הקופה. הבעלים רואה אותו בארכיון.
        </p>
      </div>

      {existing && (
        <p style={{
          margin: 0, fontSize: '0.8rem', lineHeight: 1.55, color: '#fbbf24',
          border: '1px solid rgba(251,191,36,0.35)', borderRadius: 12, padding: '9px 12px',
        }}>
          כבר הועלה דוח ללילה הזה ב-{existing.uploadedAt} על ידי {existing.uploadedByName}
          {existing.totalLabel ? ` (${existing.totalLabel})` : ''}. העלאה חדשה תשמש כתיקון — הקודם נשמר בארכיון.
        </p>
      )}

      {notSetUp && (
        <p role="alert" style={{ margin: 0, fontSize: '0.82rem', color: '#ff6b6b', lineHeight: 1.55 }}>
          ארכיון הדוחות עדיין לא הופעל במערכת, ולכן אי אפשר להעלות כרגע. פנו למפתח.
        </p>
      )}

      {/* File: camera first, then "pick a file" (gallery / PDF). Two inputs
          because `capture` forces the camera and would otherwise make a PDF or
          an existing photo impossible to choose. */}
      <input
        ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
      />
      <input
        ref={pickRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="press" onClick={() => cameraRef.current?.click()} disabled={busy || notSetUp} style={{ ...ghost, flex: 1 }}>
          📷 צילום
        </button>
        <button type="button" className="press" onClick={() => pickRef.current?.click()} disabled={busy || notSetUp} style={{ ...ghost, flex: 1 }}>
          📁 בחירת קובץ
        </button>
      </div>

      {file && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--line)', borderRadius: 12, padding: 10, background: 'var(--bg)' }}>
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="תצוגה מקדימה של הדוח שנבחר" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, flex: '0 0 auto' }} />
          ) : (
            <span aria-hidden style={{ fontSize: '1.8rem', flex: '0 0 auto' }}>📄</span>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div dir="ltr" style={{ textAlign: 'start', fontSize: '0.85rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-faint)' }}>{fmtSize(file.size)}</div>
          </div>
          <button type="button" className="press" onClick={() => choose(null)} disabled={busy} style={{ ...ghost, padding: '6px 10px' }} aria-label="הסרת הקובץ">✕</button>
        </div>
      )}

      <div>
        <label htmlFor={totalId} style={label}>סכום סופי בדוח (₪) — לא חובה</label>
        <input
          id={totalId} inputMode="decimal" dir="ltr" autoComplete="off" value={total} disabled={busy || notSetUp}
          onChange={(e) => setTotal(e.target.value.replace(/[^\d.,₪\s]/g, '').slice(0, 14))}
          placeholder="12,345.50" style={{ ...input, textAlign: 'start' }}
        />
      </div>

      <div>
        <label htmlFor={noteId} style={label}>הערה — לא חובה</label>
        <textarea
          id={noteId} rows={2} maxLength={Z_NOTE_MAX} value={note} disabled={busy || notSetUp}
          onChange={(e) => setNote(e.target.value)} style={{ ...input, resize: 'vertical' }}
        />
      </div>

      {error && <p id={errId} role="alert" style={{ margin: 0, fontSize: '0.86rem', fontWeight: 600, color: '#ff6b6b', lineHeight: 1.5 }}>{error}</p>}

      <button type="submit" className="press" disabled={!file || busy || notSetUp} style={{ ...primary, opacity: !file || busy || notSetUp ? 0.5 : 1 }}>
        {busy ? 'מעלה…' : existing ? 'העלאת תיקון' : 'העלאת הדוח'}
      </button>
    </form>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 18,
  padding: 16, display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'start',
}
const label: React.CSSProperties = { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }
const input: React.CSSProperties = {
  width: '100%', padding: '11px 13px', borderRadius: 11, border: '1px solid var(--line-strong)',
  background: 'var(--bg-elev-2)', color: 'var(--text)', fontSize: '0.95rem', fontFamily: 'inherit', outline: 'none',
}
const ghost: React.CSSProperties = {
  minHeight: 46, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line-strong)',
  background: 'transparent', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
}
const primary: React.CSSProperties = {
  minHeight: 48, width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))', boxShadow: 'var(--glow)',
  color: 'var(--bg)', fontSize: '1rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
}
const primaryLink: React.CSSProperties = {
  ...primary, display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', marginTop: 4,
}
