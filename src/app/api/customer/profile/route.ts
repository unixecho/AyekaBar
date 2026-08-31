import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getRewardsWithStatus } from '@/lib/loyalty/points'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

// The customer is always resolved from the caller's own session — never
// from the request body or a query param — so one customer can never read,
// edit, export, or delete another's data. Same rule as loyalty/checkin and
// rewards/redeem (see CLAUDE.md's "Auth model").

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
      .select('id, email, phone, first_name, last_name, points, total_visits, last_visit_at, created_at')
      .eq('auth_user_id', user.id)
      .single()

    if (customerError || !customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    // ?export=1 — a full, downloadable copy of everything this app holds
    // about this customer (data-portability / "download my data"), not the
    // trimmed dashboard shape below. Every table with a customer_id/
    // attempted_by FK into customers, in full, no row limit.
    if (request.nextUrl.searchParams.get('export')) {
      const [{ data: allVisits }, { data: allRedemptions }, { data: allAdjustments }] = await Promise.all([
        serviceClient.from('visit_logs')
          .select('id, points_awarded, visit_timestamp, table_number')
          .eq('customer_id', customer.id).order('visit_timestamp', { ascending: false }),
        serviceClient.from('reward_redemptions')
          .select('id, points_deducted, redeemed_at, rewards(reward_name, reward_name_he)')
          .eq('customer_id', customer.id).order('redeemed_at', { ascending: false }),
        serviceClient.from('point_adjustments')
          .select('id, delta, reason, created_at')
          .eq('customer_id', customer.id).order('created_at', { ascending: false }),
      ])

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        profile: {
          id: customer.id,
          email: customer.email,
          phone: customer.phone,
          firstName: customer.first_name,
          lastName: customer.last_name,
          points: customer.points,
          totalVisits: customer.total_visits,
          lastVisitAt: customer.last_visit_at,
          memberSince: customer.created_at,
        },
        visits: allVisits ?? [],
        rewardRedemptions: allRedemptions ?? [],
        pointAdjustments: allAdjustments ?? [],
      }

      return new NextResponse(JSON.stringify(exportPayload, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="ayeka-bar-my-data-${customer.id}.json"`,
        },
      })
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
        email: customer.email,
        phone: customer.phone,
        firstName: customer.first_name,
        lastName: customer.last_name,
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

// Edit — first/last name only. Email is a Google-profile snapshot (the
// customer's verified identity, same reasoning CLAUDE.md gives for why
// staff.email isn't independently editable once linked); points/visits are
// never client-writable at all any more, by anyone (see migration 046).
export async function PATCH(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!(await checkRateLimit(`customer-edit:${user.id}`, 20, 60))) {
      return rateLimitResponse()
    }

    const body = await request.json().catch(() => null) as { firstName?: string; lastName?: string; phone?: string } | null
    const firstName = body?.firstName?.trim()
    const lastName = body?.lastName?.trim()
    const phone = body?.phone?.trim()

    if (firstName !== undefined && (firstName.length === 0 || firstName.length > 60)) {
      return NextResponse.json({ error: 'שם פרטי לא תקין' }, { status: 400 })
    }
    if (lastName !== undefined && lastName.length > 60) {
      return NextResponse.json({ error: 'שם משפחה ארוך מדי' }, { status: 400 })
    }
    if (phone !== undefined && phone.length > 30) {
      return NextResponse.json({ error: 'מספר טלפון לא תקין' }, { status: 400 })
    }

    const patch: Record<string, string | null> = {}
    if (firstName !== undefined) patch.first_name = firstName
    if (lastName !== undefined) patch.last_name = lastName || null
    if (phone !== undefined) patch.phone = phone || null

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'אין מה לעדכן' }, { status: 400 })
    }

    const serviceClient = createServiceClient()
    const { error } = await serviceClient
      .from('customers')
      .update(patch)
      .eq('auth_user_id', user.id)

    if (error) {
      console.error('profile PATCH error:', error)
      return NextResponse.json({ error: 'העדכון נכשל' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('profile PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Delete — a real deletion, not a soft-delete: unlike staff (which keeps
// historical order attribution alive on purpose, see migration 041), a
// customer's loyalty data has no equivalent reason to survive them asking
// for it to be gone. auth.users' own delete cascades customers → cascades
// visit_logs/reward_redemptions/point_adjustments (all ON DELETE CASCADE,
// confirmed live against pg_constraint). The two remaining FKs into
// customers (fraud_log.attempted_by, loyalty_qr_tokens.used_by) have no
// ON DELETE action and are both nullable by design, so they're nulled
// first — preserving the security/fraud record's shape (an attempted
// redemption still shows it happened and when) without keeping the
// identifying link once the account is gone.
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!(await checkRateLimit(`customer-delete:${user.id}`, 5, 60))) {
      return rateLimitResponse()
    }

    const serviceClient = createServiceClient()

    const { data: customer } = await serviceClient
      .from('customers')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (customer) {
      await serviceClient.from('fraud_log').update({ attempted_by: null }).eq('attempted_by', customer.id)
      await serviceClient.from('loyalty_qr_tokens').update({ used_by: null }).eq('used_by', customer.id)
    }

    // Deletes the auth identity; customers (and everything cascading from
    // it) goes with it. If this fails, nothing has been silently
    // half-deleted — the two nulling updates above are themselves harmless
    // to have run even if this step now errors.
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(user.id)
    if (deleteError) {
      console.error('account delete error:', deleteError)
      return NextResponse.json({ error: 'מחיקת החשבון נכשלה' }, { status: 500 })
    }

    const response = NextResponse.json({ success: true })
    // Best-effort local sign-out of this browser's own session — the
    // account is already gone server-side regardless.
    await supabase.auth.signOut().catch(() => {})
    return response
  } catch (error) {
    console.error('profile DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
