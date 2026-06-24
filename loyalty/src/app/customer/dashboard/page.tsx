import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PointsCard from '@/components/PointsCard'
import RewardsList from '@/components/RewardsList'

interface CustomerRow {
  id: string
  points: number
  total_visits: number
  last_visit_at: string | null
  created_at: string
}

interface ProfileData {
  customer: {
    id: string
    points: number
    totalVisits: number
    lastVisitAt: string | null
    memberSince: string
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
  const { data: existing } = await supabase
    .from('customers')
    .select('id, points, total_visits, last_visit_at, created_at')
    .eq('auth_user_id', userId)
    .single()

  if (existing) return existing

  // First-time login — auto-create via security-definer function
  await supabase.rpc('get_or_create_customer')

  const { data: created } = await supabase
    .from('customers')
    .select('id, points, total_visits, last_visit_at, created_at')
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

  const { data: rewards } = await supabase
    .from('rewards')
    .select('id, reward_name, reward_name_he, required_points')
    .eq('business_id', process.env.NEXT_PUBLIC_BUSINESS_ID!)
    .eq('active', true)
    .order('required_points', { ascending: true })

  const { data: visits } = await supabase
    .from('visit_logs')
    .select('id, points_awarded, visit_timestamp')
    .eq('customer_id', customer.id)
    .order('visit_timestamp', { ascending: false })
    .limit(10)

  return {
    customer: {
      id: customer.id,
      points: customer.points,
      totalVisits: customer.total_visits,
      lastVisitAt: customer.last_visit_at,
      memberSince: customer.created_at,
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
  if (!user) redirect('/customer')

  const profile = await getProfile()
  if (!profile) redirect('/customer')

  const { customer, rewards, recentVisits } = profile

  const nextReward = rewards.find((r) => !r.unlocked) ?? null
  const progressToNext = nextReward
    ? Math.min((customer.points / nextReward.requiredPoints) * 100, 100)
    : 100

  return (
    <main style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 440, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text)', textShadow: '0 0 18px rgba(255,94,58,0.5)', margin: 0 }}>
          אייכה<span style={{ color: 'var(--neon)' }}> · </span>בר
        </h1>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-faint)' }}>מועדון נאמנות</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PointsCard
          points={customer.points}
          totalVisits={customer.totalVisits}
          nextRewardName={nextReward?.rewardNameHe ?? nextReward?.rewardName ?? null}
          nextRewardPoints={nextReward?.requiredPoints ?? null}
          progress={progressToNext}
        />

        {/* How it works */}
        <div style={{
          background: 'var(--bg-elev)', border: '1px solid var(--line)',
          borderRadius: 18, padding: '18px 20px',
        }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>איך צוברים נקודות?</h2>
          <ol style={{ margin: 0, padding: '0 20px 0 0', color: 'var(--text-dim)', fontSize: '0.88rem', lineHeight: 1.8 }}>
            <li>לפני שאתה עוזב, בקש מהצוות לפתוח קוד QR</li>
            <li>סרוק את הקוד עם המצלמה שלך</li>
            <li>קבל נקודה לכל ביקור!</li>
          </ol>
        </div>

        {/* Rewards */}
        <div>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>הפרסים שלי</h2>
          <RewardsList rewards={rewards} customerPoints={customer.points} />
        </div>

        {/* Visit history */}
        {recentVisits.length > 0 && (
          <div>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)', margin: '0 0 10px' }}>ביקורים אחרונים</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentVisits.map((v) => (
                <div key={v.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'var(--bg-elev)', border: '1px solid var(--line)',
                  borderRadius: 12, padding: '12px 16px',
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
