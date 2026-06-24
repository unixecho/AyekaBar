import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateQRToken, getExpiresAt } from '@/lib/loyalty/qr'

export async function POST(request: NextRequest) {
  try {
    // Verify the requester is authenticated (staff)
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const businessId = process.env.NEXT_PUBLIC_BUSINESS_ID!
    const token = await generateQRToken(businessId)
    const expiresAt = getExpiresAt()

    // Store the token in the database via service role (bypasses RLS)
    const serviceClient = createServiceClient()
    const { error: insertError } = await serviceClient
      .from('loyalty_qr_tokens')
      .insert({
        token,
        business_id: businessId,
        expires_at: expiresAt.toISOString(),
      })

    if (insertError) {
      console.error('Failed to store QR token:', insertError)
      return NextResponse.json({ error: 'Failed to generate QR code' }, { status: 500 })
    }

    return NextResponse.json({
      token,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('generate-qr error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
