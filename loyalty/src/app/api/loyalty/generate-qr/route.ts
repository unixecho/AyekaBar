import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/staff/guard'
import { generateQRToken, getExpiresAt } from '@/lib/loyalty/qr'

// Mints the check-in QR token staff show to customers. This is the one thing
// standing between "customer visited the bar" and "customer awarded themselves
// a point", so it MUST be staff-gated — a signed-in session is not enough.
export async function POST() {
  try {
    const auth = await requireStaff()
    if (!auth.ok) return auth.res

    const businessId = process.env.NEXT_PUBLIC_BUSINESS_ID!
    const token = await generateQRToken(businessId)
    const expiresAt = getExpiresAt()

    const { error: insertError } = await auth.service
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
