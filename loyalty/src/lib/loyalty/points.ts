import { SupabaseClient } from '@supabase/supabase-js'

export const POINTS_PER_VISIT = 1
export const COOLDOWN_HOURS = 24

export interface CustomerStats {
  id: string
  points: number
  totalVisits: number
  lastVisitAt: string | null
}

export interface RewardWithStatus {
  id: string
  rewardName: string
  rewardNameHe: string | null
  requiredPoints: number
  unlocked: boolean
}

/**
 * Check if a customer is eligible for a check-in (24h cooldown).
 * Returns true if they can check in.
 */
export async function checkCooldown(
  customerId: string,
  supabase: SupabaseClient
): Promise<boolean> {
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('visit_logs')
    .select('visit_timestamp')
    .eq('customer_id', customerId)
    .gt('visit_timestamp', cutoff)
    .limit(1)

  if (error) throw error
  return data.length === 0
}

/**
 * Get a customer's current stats.
 */
export async function getCustomerStats(
  customerId: string,
  supabase: SupabaseClient
): Promise<CustomerStats | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, points, total_visits, last_visit_at')
    .eq('id', customerId)
    .single()

  if (error || !data) return null

  return {
    id: data.id,
    points: data.points,
    totalVisits: data.total_visits,
    lastVisitAt: data.last_visit_at,
  }
}

/**
 * Get rewards with unlock status for a customer.
 */
export async function getRewardsWithStatus(
  customerPoints: number,
  businessId: string,
  supabase: SupabaseClient
): Promise<RewardWithStatus[]> {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, reward_name, reward_name_he, required_points')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('required_points', { ascending: true })

  if (error || !data) return []

  return data.map((r) => ({
    id: r.id,
    rewardName: r.reward_name,
    rewardNameHe: r.reward_name_he,
    requiredPoints: r.required_points,
    unlocked: customerPoints >= r.required_points,
  }))
}

/**
 * Find the next reward a customer is working toward.
 */
export function getNextReward(
  rewards: RewardWithStatus[],
  currentPoints: number
): RewardWithStatus | null {
  return rewards.find((r) => r.requiredPoints > currentPoints) ?? null
}
