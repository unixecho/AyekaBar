import Link from 'next/link'
import { businessDateLabel, fmtShekels } from '@/lib/zreport/rules'
import type { ZOverview } from '@/lib/zreport/server'

// The owner dashboard's "דוח Z יומי" card (2026-10-13). One line of state and a
// door to the archive — in the same spirit as ShiftStatusCard: it says what is
// true now and hands over to the page that does the work. Server-rendered; it
// is a reading aid, not a live feed (the Z report arrives once a night).

const hm = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false })

export default function ZReportCard({ overview }: { overview: ZOverview }) {
  const { status, date, windowOpen, traded } = overview
  const label = businessDateLabel(date)
  const cur = status.current

  let tone: 'ok' | 'wait' | 'missing' | 'idle' = 'idle'
  let headline: string
  let detail: string | null = null

  if (status.tableMissing) {
    headline = 'ארכיון דוחות Z עדיין לא הופעל'
    detail = 'ברגע שיופעל, אחראי/ת המשמרת יוכלו להעלות את הדוח אחרי 23:00 וכאן תראו אותו.'
  } else if (cur) {
    tone = 'ok'
    headline = `דוח Z של ${label} הועלה`
    detail = [
      `ב-${hm.format(new Date(cur.uploaded_at))}`,
      cur.uploaded_by_name ? `על ידי ${cur.uploaded_by_name}` : null,
      fmtShekels(cur.total_agorot),
      status.count > 1 ? `${status.count} גרסאות` : null,
    ].filter(Boolean).join(' · ')
  } else if (windowOpen) {
    tone = 'wait'
    headline = `ממתינים לדוח Z של ${label}`
    detail = 'החלון פתוח — אחראי/ת המשמרת או המנהל/ת הכללי/ת מעלים אותו מהלוח שלהם.'
  } else if (traded) {
    tone = 'missing'
    headline = `דוח Z של ${label} לא הועלה`
    detail = 'הייתה משמרת פעילה באותו לילה. אפשר לבקש מאחראי/ת המשמרת להעלות בערב הבא, או לפנות למפתח.'
  } else {
    headline = 'דוח Z — אין פעילות רשומה אתמול'
    detail = overview.opensInMinutes != null ? `החלון להעלאה נפתח ב-23:00.` : null
  }

  const accent = tone === 'ok' ? '#4ade80' : tone === 'wait' ? '#fbbf24' : tone === 'missing' ? '#ff6b6b' : 'var(--text-faint)'

  return (
    <section
      aria-label="דוח Z יומי" className="rise"
      style={{
        background: 'var(--bg-elev)', border: `1px solid ${tone === 'missing' ? 'rgba(255,107,107,0.4)' : 'var(--line)'}`,
        borderRadius: 18, padding: 16, margin: '0 0 22px', animationDelay: '120ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: 999, background: accent, flex: '0 0 auto' }} />
        <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>{headline}</h2>
      </div>
      {detail && <p style={{ margin: '8px 0 0', fontSize: '0.84rem', color: 'var(--text-dim)', lineHeight: 1.55 }}>{detail}</p>}
      <Link href="/owner/z-reports" className="press" style={{
        display: 'inline-block', marginTop: 12, fontSize: '0.82rem', fontWeight: 600, color: 'var(--neon-soft)', textDecoration: 'none',
      }}>
        לארכיון הדוחות ←
      </Link>
    </section>
  )
}
