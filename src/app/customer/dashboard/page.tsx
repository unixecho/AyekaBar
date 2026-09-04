import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PointsCard from '@/components/PointsCard'
import RewardsList from '@/components/RewardsList'
import SignOutButton from '@/components/SignOutButton'
import AccountControls from '@/components/AccountControls'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'האזור האישי שלי · אייכה בר' }

interface CustomerRow {
  id: string
  points: number
  total_visits: number
  last_visit_at: string | null
  created_at: string
  first_name: string | null
  last_name: string | null
  phone: string | null
}

interface ProfileData {
  customer: {
    id: string
    points: number
    totalVisits: number
    lastVisitAt: string | null
    memberSince: string
    firstName: string | null
    lastName: string | null
    phone: string | null
  }
  rewards: Array<{
    id: string
    rewardName: string
    rewardNameHe: string | null
    requiredPoints: number
    unlocked: boolean
  }>
  recentVisits: Array<{
    id: string
    points_awarded: number
    visit_timestamp: string
  }>
}

async function getOrFetchCustomer(supabase: ReturnType<typeof createClient>, userId: string): Promise<CustomerRow | null> {
  const cols = 'id, points, total_visits, last_visit_at, created_at, first_name, last_name, phone'
  const { data: existing } = await supabase
    .from('customers')
    .select(cols)
    .eq('auth_user_id', userId)
    .single()

  if (existing) return existing

  // First-time login — auto-create via security-definer function
  await supabase.rpc('get_or_create_customer')

  const { data: created } = await supabase
    .from('customers')
    .select(cols)
    .eq('auth_user_id', userId)
    .single()

  return created ?? null
}

async function getProfile(): Promise<ProfileData | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const customer = await getOrFetchCustomer(supabase, user.id)
  if (!customer) return null

  // Independent of each other — run in parallel instead of one-after-another.
  const [{ data: rewards }, { data: visits }] = await Promise.all([
    supabase
      .from('rewards')
      .select('id, reward_name, reward_name_he, required_points')
      .eq('business_id', process.env.NEXT_PUBLIC_BUSINESS_ID!)
      .eq('active', true)
      .order('required_points', { ascending: true }),
    supabase
      .from('visit_logs')
      .select('id, points_awarded, visit_timestamp')
      .eq('customer_id', customer.id)
      .order('visit_timestamp', { ascending: false })
      .limit(10),
  ])

  return {
    customer: {
      id: customer.id,
      points: customer.points,
      totalVisits: customer.total_visits,
      lastVisitAt: customer.last_visit_at,
      memberSince: customer.created_at,
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
    },
    rewards: (rewards ?? []).map((r) => ({
      id: r.id,
      rewardName: r.reward_name,
      rewardNameHe: r.reward_name_he,
      requiredPoints: r.required_points,
      unlocked: customer.points >= r.required_points,
    })),
    recentVisits: visits ?? [],
  }
}

export default async function CustomerDashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { customer, rewards, recentVisits } = profile

  const nextReward = rewards.find((r) => !r.unlocked) ?? null
  const progressToNext = nextReward
    ? Math.min((customer.points / nextReward.requiredPoints) * 100, 100)
    : 100

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 440, margin: '0 auto' }}>
      {/* Header */}
      <div className="rise" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, animationDelay: '20ms' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logo.svg" alt="" width={32} height={32} style={{ display: 'block' }} />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 18px rgba(255,94,58,0.5)', margin: 0 }}>
            אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-faint)' }}>מועדון נאמנות</span>
          <SignOutButton />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="rise" style={{ animationDelay: '90ms' }}>
          <PointsCard
            points={customer.points}
            totalVisits={customer.totalVisits}
            nextRewardName={nextReward?.rewardNameHe ?? nextReward?.rewardName ?? null}
            nextRewardPoints={nextReward?.requiredPoints ?? null}
            progress={progressToNext}
          />
        </div>

        {/* How it works */}
        <div className="rise" style={{
          background: 'var(--bg-elev)', border: '1px solid var(--line)',
          borderRadius: 18, padding: '18px 20px', animationDelay: '160ms',
        }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>איך צוברים נקודות?</h2>
          <ol style={{ margin: 0, padding: '0 20px 0 0', color: 'var(--text-dim)', fontSize: '0.88rem', lineHeight: 1.8 }}>
            <li>לפני שאתה עוזב, בקש מהצוות לפתוח קוד QR</li>
            <li>סרוק את הקוד עם המצלמה שלך</li>
            <li>קבל נקודה לכל ביקור!</li>
          </ol>
        </div>

        {/* Rewards */}
        <div className="rise" style={{ animationDelay: '230ms' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>הפרסים שלי</h2>
          <RewardsList rewards={rewards} customerPoints={customer.points} />
        </div>

        {/* My data — edit / download / delete */}
        <div className="rise" style={{ animationDelay: '360ms' }}>
          <AccountControls firstName={customer.firstName} lastName={customer.lastName} phone={customer.phone} />
        </div>

        {/* Visit history */}
        {recentVisits.length > 0 && (
          <div className="rise" style={{ animationDelay: '300ms' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>ביקורים אחרונים</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentVisits.map((v, i) => (
                <div key={v.id} className="rise" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--bg-elev)', border: '1px solid var(--line)',
                  borderRadius: 12, padding: '12px 16px', animationDelay: `${300 + Math.min(i, 6) * 35}ms`,
                }}>
                  <span style={{ fontSize: '0.88rem', color: 'var(--text-dim)' }}>
                    {new Date(v.visit_timestamp).toLocaleDateString('he-IL')}
                  </span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--neon-soft)' }}>
                    +{v.points_awarded} נקודה
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
