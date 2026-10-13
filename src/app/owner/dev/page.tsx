import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isDev } from '@/lib/staff/access'
import { badgeMeta } from '@/lib/staff/badges'
import { DEV_CATEGORIES, sectionsFor, type Section } from '@/lib/dashboard/tiles'
import { readMyShifts } from '@/lib/staff/my-shifts'
import { readDevHealth, type HealthRow } from '@/lib/owner/dev-health'
import { zonedNow } from '@/lib/shifts/presence'
import { readZOverview } from '@/lib/zreport/server'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import DashboardSections from '@/components/dashboard/DashboardSections'
import DevFlagsCard from '@/components/dashboard/DevFlagsCard'
import ShiftQuickView from '@/components/dashboard/ShiftQuickView'
import ZReportCard from '@/components/dashboard/ZReportCard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'לוח מפתח · אייכה בר', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// The developer's dashboard (2026-10-13): "make sure I have my own Dev's
// dashboard which includes all features categories for me (I must have the
// experience of a normal Employee as well)".
//
// It is the UNION, in the order a working day uses it:
//
//   1. the employee experience — shift quick view and the work tiles (the dev
//      is on the roster like anyone else),
//   2. every owner category, exactly as the owner sees them,
//   3. the developer's own tools: the in-development switches, a health check
//      that probes for the objects migrations create, and the reference links.
//
// Same registry as the other two dashboards (lib/dashboard/tiles.ts), so there
// is no second list to keep in step. Access: middleware narrows /owner/dev to
// `isDev` (an OP row carrying the Dev badge) and this page re-checks it.

const STATE_STYLE: Record<HealthRow['state'], { dot: string; label: string }> = {
  ok: { dot: '#4ade80', label: 'תקין' },
  warn: { dot: '#fbbf24', label: 'דורש טיפול' },
  bad: { dot: '#ff6b6b', label: 'תקלה' },
  info: { dot: 'var(--text-faint)', label: 'מידע' },
}

export default async function DevDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('id, role, badge, first_name, display_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me || !isDev(me)) redirect('/no-access')

  const service = createServiceClient()
  const [myShifts, health, zOverview, posRes] = await Promise.all([
    readMyShifts(me.id),
    readDevHealth(),
    readZOverview(service),
    service.from('waiter_shift_sessions').select('id').eq('status', 'active').limit(1),
  ])
  const posOpen = posRes.error ? null : (posRes.data?.length ?? 0) > 0

  const all = sectionsFor(me, DEV_CATEGORIES)
  const byId = (id: string): Section[] => all.filter((s) => s.category.id === id)
  const meta = badgeMeta(me.badge, me.role)
  const firstName = me.display_name?.trim() || me.first_name?.trim() || null

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/owner/dashboard" className="press" style={headerLink}>⚙️ ניהול</Link>
          <SignOutButton />
        </div>
      } />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="rise" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)' }}>
            {firstName ? `שלום, ${firstName}` : 'שלום'}
          </h1>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color,
            borderRadius: 999, padding: '3px 11px', fontSize: '0.76rem', fontWeight: 700,
          }}>
            <span aria-hidden>{meta.emoji}</span>{meta.he}
          </span>
        </div>

        {/* 1 — as an employee */}
        <ShiftQuickView
          shifts={myShifts.shifts} roleLabels={myShifts.roleLabels} staffId={me.id}
          timezone={myShifts.timezone} known={myShifts.known} posOpen={posOpen}
          initialNow={zonedNow(myShifts.timezone)}
        />
        <DashboardSections sections={byId('mywork')} baseDelay={120} />

        {/* 2 — as the owner */}
        <ZReportCard overview={zOverview} />
        <DashboardSections sections={all.filter((s) => ['operations', 'content', 'people', 'system'].includes(s.category.id))} baseDelay={160} />

        {/* 3 — as the developer */}
        <DevFlagsCard />

        <section aria-labelledby="dev-health" className="rise" style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 18, padding: 16 }}>
          <h2 id="dev-health" style={{ margin: '0 0 4px', fontSize: '0.98rem', fontWeight: 700, color: 'var(--text)' }}>בריאות המערכת</h2>
          <p style={{ margin: '0 0 12px', fontSize: '0.74rem', color: 'var(--text-faint)', lineHeight: 1.5 }}>
            נבדק בכל טעינה. מיגרציות נבדקות לפי האובייקטים שהן יוצרות — לא לפי רשימת המיגרציות של Supabase.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {health.map((r) => (
              <li key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: 999, background: STATE_STYLE[r.state].dot, marginTop: 6, flex: '0 0 auto' }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)' }}>
                    {r.label} <span style={srOnly}>— {STATE_STYLE[r.state].label}</span>
                  </span>
                  <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-dim)', lineHeight: 1.5, wordBreak: 'break-word' }}>{r.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <DashboardSections sections={byId('dev')} baseDelay={200} />
      </div>
    </main>
  )
}

const headerLink: React.CSSProperties = {
  fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-dim)', textDecoration: 'none',
  border: '1px solid var(--line-strong)', borderRadius: 999, padding: '5px 11px', whiteSpace: 'nowrap',
}
const srOnly: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
