import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { verifyQRToken } from '@/lib/loyalty/qr'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token } = body as { token: string }

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    // 1. Verify the customer is authenticated
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Verify the JWT signature and expiry
    const payload = await verifyQRToken(token)
    if (!payload) {
      await logFraud(null, 'invalid_or_expired_token', token, request)
      return NextResponse.json({ error: 'Invalid or expired QR code' }, { status: 400 })
    }

    const serviceClient = createServiceClient()

    // 3. Get the customer record
    const { data: customer, error: customerError } = await serviceClient
      .from('customers')
      .select('id, points')
      .eq('auth_user_id', user.id)
      .single()

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found. Please sign in again.' }, { status: 404 })
    }

    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? null
    const deviceInfo = request.headers.get('user-agent') ?? null

    // 4. Call the award_points DB function — handles all fraud checks atomically
    const { data: result, error: rpcError } = await serviceClient
      .rpc('award_points', {
        p_token: token,
        p_customer_id: customer.id,
        p_device_info: deviceInfo,
      })

    if (rpcError) {
      console.error('award_points RPC error:', rpcError)
      return NextResponse.json({ error: 'Check-in failed. Please try again.' }, { status: 500 })
    }

    const resultData = result as {
      success: boolean
      points_awarded?: number
      total_points?: number
      error?: string
    }

    if (!resultData.success) {
      const errorMap: Record<string, { status: number; message: string }> = {
        token_not_found:    { status: 400, message: 'QR code not found' },
        expired_token:      { status: 400, message: 'QR code has expired. Ask staff to refresh.' },
        token_already_used: { status: 409, message: 'This QR code has already been used.' },
        cooldown_active:    { status: 429, message: 'You already checked in today. Come back tomorrow!' },
      }

      const mapped = errorMap[resultData.error ?? ''] ?? { status: 400, message: 'Check-in failed' }
      return NextResponse.json({ error: mapped.message }, { status: mapped.status })
    }

    return NextResponse.json({
      success: true,
      pointsAwarded: resultData.points_awarded,
      totalPoints: resultData.total_points,
    })
  } catch (error) {
    console.error('checkin error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function logFraud(
  customerId: string | null,
  reason: string,
  token: string,
  request: NextRequest
) {
  try {
    const serviceClient = createServiceClient()
    const ip = request.headers.get('x-forwarded-for') ?? null
    await serviceClient.from('fraud_log').insert({
      attempted_by: customerId,
      reason,
      token_attempted: token,
      ip_address: ip,
    })
  } catch {
    // Non-critical — don't throw
  }
}
