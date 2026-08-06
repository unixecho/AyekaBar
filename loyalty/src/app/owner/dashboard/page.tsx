import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { splitName } from '@/lib/staff/name'
import OwnerHeader from '@/components/OwnerHeader'
import StaffManager from '@/components/StaffManager'
import LoyaltyToggle from '@/components/LoyaltyToggle'
import PortalLinksEditor from '@/components/PortalLinksEditor'
import SignOutButton from '@/components/SignOutButton'
import { getLoyaltyEnabled, getLoyaltyVisible, getPortalLinks } from '@/lib/settings/server'

export default async function OwnerDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/owner')

  // Middleware already gates this, but verify server-side too (defense in depth).
  const { data: me } = await supabase
    .from('staff')
    .select('role, email, first_name')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!me || me.role !== 'owner') redirect('/owner?denied=1')

  // Self-heal: a manually-seeded owner row has no name/email — backfill it from
  // the owner's own Google profile so the roster shows them properly.
  if (!me.email || !me.first_name) {
    const { first, last } = splitName(user)
    await createServiceClient()
      .from('staff')
      .update({ email: user.email, first_name: first, last_name: last })
      .eq('auth_user_id', user.id)
  }

  const [loyaltyEnabled, loyaltyVisible, portalLinks] = await Promise.all([
    getLoyaltyEnabled(),
    getLoyaltyVisible(),
    getPortalLinks(),
  ])

  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader right={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-faint)' }}>ניהול</span>
          <SignOutButton />
        </div>
      } />

      {/* Loyalty club on/off */}
      <div style={{ marginBottom: 16 }}>
        <LoyaltyToggle initialEnabled={loyaltyEnabled} initialVisible={loyaltyVisible} />
      </div>

      {/* Portal button destinations */}
      <div className="rise" style={{ marginBottom: 16, animationDelay: '100ms' }}>
        <PortalLinksEditor initialLinks={portalLinks} />
      </div>

      {/* Quick links */}
      <div className="rise" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 20, animationDelay: '140ms' }}>
        <Link href="/owner/customers" style={navCard}>
          <span style={{ fontSize: '1.3rem' }}>👥</span>
          <span>לקוחות ונקודות</span>
        </Link>
        <Link href="/owner/rewards" style={navCard}>
          <span style={{ fontSize: '1.3rem' }}>🎁</span>
          <span>קטלוג פרסים</span>
        </Link>
        <Link href="/owner/editor" style={navCard}>
          <span style={{ fontSize: '1.3rem' }}>📝</span>
          <span>עריכת תפריט</span>
        </Link>
        <Link href="/menu" target="_blank" style={navCard}>
          <span style={{ fontSize: '1.3rem' }}>🍽️</span>
          <span>צפייה בתפריט</span>
        </Link>
      </div>

      <div className="rise" style={{ animationDelay: '210ms' }}>
        <StaffManager currentUserId={user.id} />
      </div>
    </main>
  )
}

const navCard: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  padding: '14px 8px',
  borderRadius: 14,
  border: '1px solid var(--line)',
  background: 'var(--bg-elev)',
  color: 'var(--text)',
  textDecoration: 'none',
  fontSize: '0.78rem',
  fontWeight: 600,
  textAlign: 'center',
}
