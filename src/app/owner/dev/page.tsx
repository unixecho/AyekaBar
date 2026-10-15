import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isDev } from '@/lib/staff/access'
import { badgeMeta } from '@/lib/staff/badges'
import { DEV_CATEGORIES, sectionsFor } from '@/lib/dashboard/tiles'
import { parseLens } from '@/lib/dashboard/lens'
import { readDevHealth, type HealthRow } from '@/lib/owner/dev-health'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import DashboardSections from '@/components/dashboard/DashboardSections'
import DevFlagsCard from '@/components/dashboard/DevFlagsCard'
import EmployeeDashboard from '@/components/dashboard/EmployeeDashboard'
import OwnerDashboard from '@/components/dashboard/OwnerDashboard'
import LensTabs from '@/components/dashboard/LensTabs'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'לוח מפתח · אייכה בר', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// The developer's dashboard — ONE perspective with all three views (owner, 2026-10-15: "instead of having 3 different
// perspectives give me one perspective that has all 3 views: Owner/Manager, Employee, Developer").
//
// It used to be a long page stacking the employee view over the owner's tiles over the dev tools, with the real
// /owner/dashboard and /staff/dashboard as two further places to be. Now:
//
//   מנהל   — exactly the owner's dashboard (components/dashboard/OwnerDashboard.tsx: the pulse, the signals, the
//            shift deck, the Z report, every owner category),
//   עובד   — exactly what staff see (components/dashboard/EmployeeDashboard.tsx),
//   מפתח   — the developer's own tools: the in-development switches, a health check that probes for the objects
//            migrations create, and the reference links.
//
// The first two are the SAME components the owner and staff pages render, so the developer sees what those people see
// by construction. /owner/dashboard and /staff/dashboard send a developer here (`?view=manager` / `?view=employee`),
// so there is no second place to be. The view is `?view=` (default: the developer's own tools); see LensTabs.
//
// Access: middleware narrows /owner/dev to `isDev` (an OP row carrying the Dev badge) and this page re-checks it.

const STATE_STYLE: Record<HealthRow['state'], { dot: string; label: string }> = {
  ok: { dot: '#4ade80', label: 'תקין' },
  warn: { dot: '#fbbf24', label: 'דורש טיפול' },
  bad: { dot: '#ff6b6b', label: 'תקלה' },
  info: { dot: 'var(--text-faint)', label: 'מידע' },
}

export default async function DevDashboardPage({ searchParams }: { searchParams?: { view?: string | string[] } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('id, role, badge, first_name, display_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me || !isDev(me)) redirect('/no-access')

  const health = await readDevHealth()
  const devSections = sectionsFor(me, DEV_CATEGORIES).filter((s) => s.category.id === 'dev')
  const meta = badgeMeta(me.badge, me.role)
  const firstName = me.display_name?.trim() || me.first_name?.trim() || null

  const devPanel = (
    <>
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

      <DashboardSections sections={devSections} baseDelay={120} />
    </>
  )

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader right={<SignOutButton />} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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

        <LensTabs
          initial={parseLens(searchParams?.view)}
          panels={{
            manager: <OwnerDashboard me={me} />,
            employee: <EmployeeDashboard me={me} />,
            dev: devPanel,
          }}
        />
      </div>
    </main>
  )
}

const srOnly: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden',
  clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}
