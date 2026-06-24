import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { rewardId } = body as { rewardId: string }

    if (!rewardId) {
      return NextResponse.json({ error: 'Missing rewardId' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const serviceClient = createServiceClient()

    // Get customer
    const { data: customer, error: customerError } = await serviceClient
      .from('customers')
      .select('id, points')
      .eq('auth_user_id', user.id)
      .single()

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Get reward
    const { data: reward, error: rewardError } = await serviceClient
      .from('rewards')
      .select('id, reward_name, required_points, active')
      .eq('id', rewardId)
      .single()

    if (rewardError || !reward) {
      return NextResponse.json({ error: 'Reward not found' }, { status: 404 })
    }

    if (!reward.active) {
      return NextResponse.json({ error: 'This reward is no longer available' }, { status: 400 })
    }

    if (customer.points < reward.required_points) {
      return NextResponse.json({
        error: `Not enough points. Need ${reward.required_points}, have ${customer.points}.`,
      }, { status: 400 })
    }

    // Deduct points and create redemption record atomically
    const { error: deductError } = await serviceClient
      .from('customers')
      .update({ points: customer.points - reward.required_points })
      .eq('id', customer.id)

    if (deductError) {
      return NextResponse.json({ error: 'Failed to redeem reward' }, { status: 500 })
    }

    const { error: redemptionError } = await serviceClient
      .from('reward_redemptions')
      .insert({
        customer_id: customer.id,
        reward_id: reward.id,
        points_deducted: reward.required_points,
      })

    if (redemptionError) {
      // Non-critical log failure — points already deducted
      console.error('Failed to log redemption:', redemptionError)
    }

    return NextResponse.json({
      success: true,
      reward: reward.reward_name,
      pointsDeducted: reward.required_points,
      remainingPoints: customer.points - reward.required_points,
    })
  } catch (error) {
    console.error('redeem error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
