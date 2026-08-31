import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp, rateLimitResponse } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const ip = clientIp(request)
    if (!(await checkRateLimit(`redeem:${ip}`, 10, 60))) {
      return rateLimitResponse()
    }

    const body = await request.json().catch(() => null) as { rewardId?: string } | null
    const rewardId = body?.rewardId

    if (!rewardId || typeof rewardId !== 'string') {
      return NextResponse.json({ error: 'Missing rewardId' }, { status: 400 })
    }

    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const serviceClient = createServiceClient()

    // The customer is resolved from the caller's own session — never from the
    // request body — so one customer can never redeem against another's balance.
    const { data: customer, error: customerError } = await serviceClient
      .from('customers')
      .select('id')
      .eq('auth_user_id', user.id)
      .single()

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // Check + deduct + audit row, atomically (see migration 008). Doing this in
    // JS was a double-spend race.
    const { data: result, error: rpcError } = await serviceClient.rpc('redeem_reward', {
      p_customer_id: customer.id,
      p_reward_id: rewardId,
      p_business_id: process.env.NEXT_PUBLIC_BUSINESS_ID!,
    })

    if (rpcError) {
      console.error('redeem_reward RPC error:', rpcError)
      return NextResponse.json({ error: 'Failed to redeem reward' }, { status: 500 })
    }

    const data = result as {
      success: boolean
      error?: string
      required?: number
      available?: number
      reward_name?: string
      points_deducted?: number
      remaining_points?: number
    }

    if (!data.success) {
      const mapped: Record<string, { status: number; message: string }> = {
        reward_not_found:    { status: 404, message: 'Reward not found' },
        reward_inactive:     { status: 400, message: 'This reward is no longer available' },
        insufficient_points: {
          status: 400,
          message: `Not enough points. Need ${data.required}, have ${data.available}.`,
        },
      }
      const m = mapped[data.error ?? ''] ?? { status: 400, message: 'Failed to redeem reward' }
      return NextResponse.json({ error: m.message }, { status: m.status })
    }

    return NextResponse.json({
      success: true,
      reward: data.reward_name,
      pointsDeducted: data.points_deducted,
      remainingPoints: data.remaining_points,
    })
  } catch (error) {
    console.error('redeem error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
