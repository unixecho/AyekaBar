import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getRewardsWithStatus } from '@/lib/loyalty/points'

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const serviceClient = createServiceClient()
    const businessId = process.env.NEXT_PUBLIC_BUSINESS_ID!

    // Get customer record
    const { data: customer, error: customerError } = await serviceClient
      .from('customers')
      .select('id, points, total_visits, last_visit_at, created_at')
      .eq('auth_user_id', user.id)
      .single()

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Get rewards with unlock status
    const rewards = await getRewardsWithStatus(customer.points, businessId, serviceClient)

    // Get recent visits
    const { data: visits } = await serviceClient
      .from('visit_logs')
      .select('id, points_awarded, visit_timestamp')
      .eq('customer_id', customer.id)
      .order('visit_timestamp', { ascending: false })
      .limit(10)

    // Get recent redemptions
    const { data: redemptions } = await serviceClient
      .from('reward_redemptions')
      .select('id, points_deducted, redeemed_at, rewards(reward_name, reward_name_he)')
      .eq('customer_id', customer.id)
      .order('redeemed_at', { ascending: false })
      .limit(5)

    return NextResponse.json({
      customer: {
        id: customer.id,
        points: customer.points,
        totalVisits: customer.total_visits,
        lastVisitAt: customer.last_visit_at,
        memberSince: customer.created_at,
      },
      rewards,
      recentVisits: visits ?? [],
      recentRedemptions: redemptions ?? [],
    })
  } catch (error) {
    console.error('profile error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
