'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

// Draws a PDF onto canvases, one per page, at the width of its container.
//
// WHY NOT <iframe>/<embed>: Android Chrome and iOS Safari cannot show a PDF inside a page, and this site sends
// `X-Frame-Options: DENY` regardless. pdf.js is the only way to give a phone the same in-page viewer a desktop gets.
//
// The library is VENDORED (public/vendor/pdfjs/ — see its README for why it is not an npm dependency) and loaded the
// first time a PDF is opened, from our own origin; nothing is fetched from anyone else, and a payslip never leaves the
// device except to come from our own route.
//
// ⚠️ `isEvalSupported: false` on EVERY getDocument() call. pdf.js ≤ 4.1 could be made to run script from a crafted PDF
// font through eval (CVE-2024-4367); this build predates the fix and the option closes that path.
// scripts/check-payslips.mjs fails if a getDocument call lacks it.
//
// PASSWORD-PROTECTED PDFs are normal for payslips in Israel (payroll software commonly locks them with the employee's
// ID number), so a locked file asks for the password instead of failing. The password is kept in memory only, for as
// long as the caller keeps it, and is never written anywhere or sent anywhere — pdf.js uses it locally.

const PDFJS_DIR = '/vendor/pdfjs/3.11.174'
/** More pages than this are not drawn (a payslip is one or two). The viewer offers the original instead. */
const MAX_PAGES = 12
/** Sharp on a phone, bounded on a desktop. */
const MAX_DPR = 2
/** Mobile Safari refuses canvases past ~16.7M pixels; stay well under. */
const MAX_PIXELS = 9_000_000

interface PdfViewport { width: number; height: number }
interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void>; cancel(): void }
}
interface PdfDoc { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void> }
interface PdfTask {
  promise: Promise<PdfDoc>
  destroy(): Promise<void> | void
  onPassword?: (update: (password: string) => void, reason: number) => void
}
interface PdfLib {
  getDocument(o: { data: Uint8Array; isEvalSupported: boolean; password?: string }): PdfTask
  GlobalWorkerOptions: { workerSrc: string }
}
declare global { interface Window { pdfjsLib?: PdfLib } }

let loading: Promise<PdfLib> | null = null
function loadPdfJs(): Promise<PdfLib> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib)
  if (loading) return loading
  loading = new Promise<PdfLib>((resolve, reject) => {
    const el = document.createElement('script')
    el.src = `${PDFJS_DIR}/pdf.min.js`
    el.async = true
    el.onload = () => {
      const lib = window.pdfjsLib
      if (!lib) { loading = null; reject(new Error('pdf.js did not initialise')); return }
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_DIR}/pdf.worker.min.js`
      resolve(lib)
    }
    el.onerror = () => { loading = null; reject(new Error('pdf.js failed to load')) }
    document.head.appendChild(el)
  })
  return loading
}

export type PdfStatus = 'loading' | 'ready' | 'error'

export default function PdfPages({
  src, label, savedPassword, onPasswordAccepted, onStatus,
}: {
  src: string
  /** Names the document for assistive technology: "תלוש שכר ספטמבר 2026". */
  label: string
  /** A password worth trying first (the one that opened this person's last payslip). */
  savedPassword?: string
  onPasswordAccepted?: (password: string) => void
  onStatus?: (status: PdfStatus, detail?: string) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PdfDoc | null>(null)
  const updatePasswordRef = useRef<((pw: string) => void) | null>(null)
  const triedPasswordRef = useRef<string | null>(null)
  const typedRef = useRef(false)
  const [pages, setPages] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [status, setStatus] = useState<PdfStatus>('loading')
  const [asking, setAsking] = useState<null | 'need' | 'wrong'>(null)
  const [width, setWidth] = useState(0)
  const [pw, setPw] = useState('')

  const report = useCallback((s: PdfStatus, detail?: string) => { setStatus(s); onStatus?.(s, detail) }, [onStatus])

  // Container width, so the page fills it on a 280px fold and on a desktop alike — and refits when the phone is
  // rotated with a payslip open. ResizeObserver does the work; the window events are the belt to its braces (an old
  // browser without it, or a page that is not being painted, still re-measures when the window changes shape).
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setWidth((w) => { const n = Math.floor(el.clientWidth); return n > 0 && Math.abs(n - w) >= 8 ? n : w })
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      ro?.disconnect()
    }
  }, [])

  // Load the document whenever the source changes.
  useEffect(() => {
    let cancelled = false
    let task: PdfTask | null = null
    setPages(0); setTruncated(false); setAsking(null); setPw('')
    docRef.current = null; updatePasswordRef.current = null; triedPasswordRef.current = null; typedRef.current = false
    report('loading')

    ;(async () => {
      try {
        const [lib, res] = await Promise.all([
          loadPdfJs(),
          fetch(src, { credentials: 'same-origin', cache: 'no-store' }),
        ])
        if (!res.ok) {
          const j = await res.json().catch(() => null) as { error?: string } | null
          throw new Error(j?.error ?? `HTTP ${res.status}`)
        }
        const data = new Uint8Array(await res.arrayBuffer())
        if (cancelled) return
        task = lib.getDocument({ data, isEvalSupported: false })
        task.onPassword = (update, reason) => {
          // reason 1 = a password is needed; 2 = the one given is wrong. A remembered password is tried once,
          // silently; if it fails, or there is none, the person is asked — and "wrong" is only said about a password
          // THEY typed.
          updatePasswordRef.current = update
          if (reason === 1 && savedPassword && triedPasswordRef.current === null) {
            triedPasswordRef.current = savedPassword
            update(savedPassword)
            return
          }
          if (!cancelled) setAsking(reason === 2 && typedRef.current ? 'wrong' : 'need')
        }
        const doc = await task.promise
        if (cancelled) { void doc.destroy(); return }
        docRef.current = doc
        if (triedPasswordRef.current) onPasswordAccepted?.(triedPasswordRef.current)
        setAsking(null)
        setTruncated(doc.numPages > MAX_PAGES)
        setPages(Math.min(doc.numPages, MAX_PAGES))
      } catch (err) {
        if (!cancelled) report('error', err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
      void task?.destroy()
      void docRef.current?.destroy()
      docRef.current = null
    }
    // savedPassword is read once per document on purpose: changing it must not reload the file mid-view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // Draw (and redraw on a width change). Each canvas is owned by React; we only paint into it.
  useEffect(() => {
    const doc = docRef.current
    const box = boxRef.current
    if (!doc || !box || !pages || !width) return
    let cancelled = false
    const tasks: { cancel(): void }[] = []
    ;(async () => {
      try {
        const canvases = Array.from(box.querySelectorAll('canvas'))
        for (let i = 0; i < pages; i++) {
          const page = await doc.getPage(i + 1)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          const fit = width / base.width                      // CSS pixels per PDF point
          const cssPixels = (base.width * fit) * (base.height * fit)
          // As sharp as the screen allows, but never past what a phone's canvas can hold.
          const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_DPR, Math.sqrt(MAX_PIXELS / cssPixels)))
          const viewport = page.getViewport({ scale: fit * dpr })
          const canvas = canvases[i] as HTMLCanvasElement | undefined
          const ctx = canvas?.getContext('2d')
          if (!canvas || !ctx) continue
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = `${width}px`
          canvas.style.height = `${Math.round(viewport.height / dpr)}px`
          const task = page.render({ canvasContext: ctx, viewport })
          tasks.push(task)
          await task.promise
          if (i === 0 && !cancelled) report('ready')
        }
      } catch (err) {
        // A cancelled render rejects; that is us moving on, not a failure.
        if (!cancelled && !/cancel/i.test(String((err as Error)?.name ?? err))) report('error', String((err as Error)?.message ?? err))
      }
    })()
    return () => { cancelled = true; tasks.forEach((t) => { try { t.cancel() } catch { /* already done */ } }) }
  }, [pages, width, report])

  function submitPassword(e: FormEvent) {
    e.preventDefault()
    const value = pw
    if (!value || !updatePasswordRef.current) return
    typedRef.current = true
    triedPasswordRef.current = value
    setPw('')
    updatePasswordRef.current(value)
  }

  return (
    <div ref={boxRef} style={{ width: '100%' }}>
      {asking && (
        <form onSubmit={submitPassword} style={askStyle}>
          <div aria-hidden style={{ fontSize: '1.6rem' }}>🔒</div>
          <p style={{ margin: 0, fontWeight: 800, color: 'var(--text)', fontSize: '1rem' }}>
            {asking === 'wrong' ? 'הסיסמה לא נכונה' : 'הקובץ מוגן בסיסמה'}
          </p>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
            תלושי שכר נעולים לרוב בסיסמה — בדרך כלל מספר הזהות. הסיסמה נשארת במכשיר הזה בלבד ולא נשלחת לשום מקום.
          </p>
          <label htmlFor="pdf-pw" className="sr-only" style={srOnly}>סיסמת הקובץ</label>
          <input
            id="pdf-pw" type="password" dir="ltr" value={pw} autoFocus autoComplete="off"
            onChange={(e) => setPw(e.target.value)} style={pwInput}
          />
          <button type="submit" className="press" disabled={!pw} style={{ ...pwBtn, opacity: pw ? 1 : 0.5 }}>פתיחה</button>
        </form>
      )}

      {!asking && status === 'loading' && !pages && (
        <div role="status" aria-label="טוען" style={{ display: 'grid', gap: 10 }}>
          <div className="payslip-shimmer" style={{ height: 'min(70dvh, 520px)', borderRadius: 12 }} />
        </div>
      )}

      {Array.from({ length: pages }, (_, i) => (
        <canvas
          key={`${src}-${i}`} role="img" aria-label={`${label} — עמוד ${i + 1} מתוך ${pages}`}
          style={{ display: 'block', margin: i ? '12px auto 0' : '0 auto', maxWidth: '100%', background: '#fff', borderRadius: 6, boxShadow: '0 4px 24px rgba(0,0,0,0.35)' }}
        />
      ))}

      {truncated && (
        <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-faint)', margin: '12px 0 0' }}>
          מוצגים {MAX_PAGES} העמודים הראשונים. את הקובץ המלא אפשר להוריד.
        </p>
      )}
    </div>
  )
}

const askStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 10, textAlign: 'center',
  maxWidth: 360, margin: '8vh auto 0', padding: '20px 18px', borderRadius: 18,
  background: 'var(--bg-elev)', border: '1px solid var(--line)',
}
const pwInput: CSSProperties = {
  width: '100%', padding: '12px 13px', borderRadius: 11, border: '1px solid var(--line-strong)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: '1rem', fontFamily: 'inherit', outline: 'none', textAlign: 'center',
}
const pwBtn: CSSProperties = {
  minHeight: 46, borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, var(--neon), var(--neon-soft))',
  color: 'var(--bg)', fontSize: '1rem', fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
}
const srOnly: CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
