import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isOp } from '@/lib/staff/access'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import { businessDateLabel, fmtShekels } from '@/lib/zreport/rules'
import { tradedDates, zArchive, type ZReportRow } from '@/lib/zreport/server'
import type { ISODate } from '@/lib/shifts/types'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'דוחות Z · אייכה בר' }
export const dynamic = 'force-dynamic'

// The daily Z-report archive (2026-10-13). One block per business date, newest
// first. A date shows its CURRENT report (the newest upload) and, collapsed
// under it, any earlier versions — a correction is a new upload, never an edit
// (migration 056), so the history of "who filed what, when" is complete.
//
// Nights with no report are flagged when the bar demonstrably traded that night
// (a POS shift session began in it): a gap in a till record is exactly what an
// owner opens this page to find.

const hm = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false })
const dmy = new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' })

export default async function ZReportsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('staff').select('role, badge').eq('auth_user_id', user.id).maybeSingle()
  if (!me || !isOp(me)) redirect('/no-access')

  const service = createServiceClient()
  const [archive, traded] = await Promise.all([zArchive(service), tradedDates(service, 30)])

  // Group the (already newest-first) rows by business date.
  const byDate = new Map<ISODate, ZReportRow[]>()
  for (const r of archive.rows) byDate.set(r.business_date, [...(byDate.get(r.business_date) ?? []), r])
  // …and add the traded-but-unfiled nights, so the gap is a visible row. Only
  // when the archive itself is readable: with the table missing, every night
  // would otherwise be reported "missing".
  if (!archive.tableMissing && !archive.failed) {
    for (const d of traded) if (!byDate.has(d)) byDate.set(d, [])
  }
  const dates = Array.from(byDate.keys()).sort().reverse()

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />

      <div className="rise" style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)', margin: 0 }}>דוח Z יומי</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.55 }}>
          דוח הסגירה של הקופה בכל לילה. אחראי/ת המשמרת או המנהל/ת הכללי/ת מעלים אותו מהלוח שלהם,
          מ-23:00 ועד הבוקר. תיקון נשמר כגרסה חדשה — הקודמת נשארת.
        </p>
      </div>

      {archive.tableMissing && (
        <p className="rise" style={notice}>
          ארכיון הדוחות עדיין לא הופעל במסד הנתונים (מיגרציה 056). עד אז אי אפשר להעלות דוחות.
        </p>
      )}
      {archive.failed && <p role="alert" style={{ ...notice, color: '#ff6b6b' }}>טעינת הארכיון נכשלה. נסו לרענן.</p>}

      {!archive.tableMissing && !archive.failed && dates.length === 0 && (
        <p className="rise" style={notice}>עדיין לא הועלו דוחות.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dates.map((date, i) => {
          const rows = byDate.get(date) ?? []
          const [cur, ...older] = rows
          return (
            <section
              key={date} className="rise" aria-label={businessDateLabel(date)}
              style={{
                background: 'var(--bg-elev)', borderRadius: 14, padding: '13px 14px', animationDelay: `${Math.min(i, 8) * 35}ms`,
                border: `1px solid ${cur ? 'var(--line)' : 'rgba(255,107,107,0.4)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text)' }}>{businessDateLabel(date)}</h2>
                {cur ? (
                  <span style={{ ...chip, color: '#4ade80', borderColor: 'rgba(74,222,128,0.4)' }}>הועלה</span>
                ) : (
                  <span style={{ ...chip, color: '#ff6b6b', borderColor: 'rgba(255,107,107,0.45)' }}>חסר</span>
                )}
                {older.length > 0 && <span style={chip}>{rows.length} גרסאות</span>}
              </div>

              {cur ? (
                <>
                  <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                    {dmy.format(new Date(cur.uploaded_at))} · {hm.format(new Date(cur.uploaded_at))}
                    {cur.uploaded_by_name ? ` · ${cur.uploaded_by_name}` : ''}
                    {fmtShekels(cur.total_agorot) ? ` · ${fmtShekels(cur.total_agorot)}` : ''}
                  </p>
                  {cur.note && <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>“{cur.note}”</p>}
                  <a href={`/api/owner/z-reports/file?id=${cur.id}`} target="_blank" rel="noopener noreferrer" className="press" style={openLink}>
                    {cur.file_mime === 'application/pdf' ? '📄 פתיחת ה-PDF' : '🖼️ פתיחת התמונה'}
                  </a>
                  {older.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ fontSize: '0.78rem', color: 'var(--text-faint)', cursor: 'pointer' }}>גרסאות קודמות</summary>
                      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {older.map((o) => (
                          <li key={o.id} style={{ fontSize: '0.78rem', color: 'var(--text-dim)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                            <span>{hm.format(new Date(o.uploaded_at))} · {o.uploaded_by_name || 'צוות'}{fmtShekels(o.total_agorot) ? ` · ${fmtShekels(o.total_agorot)}` : ''}</span>
                            <a href={`/api/owner/z-reports/file?id=${o.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--neon-soft)' }}>פתיחה</a>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                  הייתה משמרת פעילה באותו לילה, ולא הועלה דוח Z.
                </p>
              )}
            </section>
          )
        })}
      </div>
    </main>
  )
}

const notice: React.CSSProperties = {
  fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6, margin: '0 0 14px',
  border: '1px dashed var(--line-strong)', borderRadius: 12, padding: '12px 14px',
}
const chip: React.CSSProperties = {
  fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-faint)',
  border: '1px solid var(--line-strong)', borderRadius: 999, padding: '1px 8px',
}
const openLink: React.CSSProperties = {
  display: 'inline-block', marginTop: 10, fontSize: '0.84rem', fontWeight: 700, color: 'var(--neon-soft)',
  textDecoration: 'none', border: '1px solid var(--line-strong)', borderRadius: 10, padding: '7px 12px',
}
