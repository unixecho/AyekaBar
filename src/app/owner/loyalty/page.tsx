import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import LoyaltyToggle from '@/components/LoyaltyToggle'
import SignOutButton from '@/components/SignOutButton'
import { getLoyaltyEnabled, getLoyaltyVisible } from '@/lib/settings/server'

// Split out of /owner/dashboard on 2026-08-29. The club's on/off switch used
// to sit on the dashboard while the two screens it governs — customers and
// the reward catalog — were tiles in a grid alongside the floor map and the
// audit log. Three parts of one product, in three unrelated places.
//
// They are gathered here. The tiles below are the same destinations that were
// on the dashboard; nothing became unreachable, it moved one level down into
// the thing it belongs to.

const T = {
  members: 'חברי מועדון',
  points: 'נקודות פעילות',
  redemptions: 'מימושים',
  statsHint: 'נכון לעכשיו. המספרים מתעדכנים עם כל כניסה ומימוש.',
  customers: 'לקוחות ונקודות',
  rewards: 'קטלוג פרסים',
}

/** Club-wide counters. Service-role, because RLS scopes `customers` to the
 *  signed-in customer — an owner reading the club's size through their own
 *  session would legitimately see nothing. Fails to nulls rather than
 *  throwing: an unreadable counter must not take the switch down with it. */
async function readClubStats() {
  try {
    const service = createServiceClient()
    const [members, redemptions, points] = await Promise.all([
      service.from('customers').select('id', { count: 'exact', head: true }),
      service.from('reward_redemptions').select('id', { count: 'exact', head: true }),
      service.from('customers').select('points'),
    ])
    return {
      members: members.count ?? null,
      redemptions: redemptions.count ?? null,
      points: points.data
        ? points.data.reduce((sum, c) => sum + (c.points ?? 0), 0)
        : null,
    }
  } catch {
    return { members: null, redemptions: null, points: null }
  }
}

export default async function OwnerLoyaltyPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const [loyaltyEnabled, loyaltyVisible, stats] = await Promise.all([
    getLoyaltyEnabled(),
    getLoyaltyVisible(),
    readClubStats(),
  ])

  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />

      {/* The switch first: it decides whether anything below it is live. */}
      <div style={{ marginBottom: 16 }}>
        <LoyaltyToggle initialEnabled={loyaltyEnabled} initialVisible={loyaltyVisible} />
      </div>

      <div className="rise" style={{ ...statsCard, animationDelay: '120ms' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <Stat value={stats.members} label={T.members} />
          <Stat value={stats.points} label={T.points} />
          <Stat value={stats.redemptions} label={T.redemptions} />
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--text-faint)', margin: '10px 0 0', lineHeight: 1.5 }}>
          {T.statsHint}
        </p>
      </div>

      <div className="rise" style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
        animationDelay: '180ms',
      }}>
        <Link href="/owner/customers" style={navCard}>
          <span style={{ fontSize: '1.3rem' }} aria-hidden>👥</span>
          <span>{T.customers}</span>
        </Link>
        <Link href="/owner/rewards" style={navCard}>
          <span style={{ fontSize: '1.3rem' }} aria-hidden>🎁</span>
          <span>{T.rewards}</span>
        </Link>
      </div>
    </main>
  )
}

/** A null count means the read failed — shown as a dash, never as 0. A zero
 *  the owner can act on and a zero that means "I don't know" must not look
 *  identical. */
function Stat({ value, label }: { value: number | null; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <b style={{
        display: 'block', fontSize: '1.3rem', fontWeight: 800, lineHeight: 1.15,
        fontVariantNumeric: 'tabular-nums',
        color: value === null ? 'var(--text-faint)' : 'var(--text)',
      }}>{value === null ? '—' : value.toLocaleString('he-IL')}</b>
      <small style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-faint)', fontWeight: 600, marginTop: 3 }}>
        {label}
      </small>
    </div>
  )
}

const statsCard: React.CSSProperties = {
  background: 'var(--bg-elev)', border: '1px solid var(--line)',
  borderRadius: 16, padding: 16, marginBottom: 16,
}
const navCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  padding: '14px 8px', borderRadius: 14,
  border: '1px solid var(--line)', background: 'var(--bg-elev)',
  color: 'var(--text)', textDecoration: 'none',
  fontSize: '0.78rem', fontWeight: 600, textAlign: 'center',
}
