import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'

const LIST_COLS = 'id, first_name, last_name, email, phone, points, total_visits, last_visit_at, created_at'

const CSV_COLS = ['first_name', 'last_name', 'email', 'phone', 'points', 'total_visits', 'last_visit_at', 'created_at'] as const
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const { service } = auth
  const url = new URL(request.url)

  // ?stats=1 → overview tiles
  if (url.searchParams.get('stats')) {
    const { data, error } = await service.rpc('loyalty_overview')
    if (error) return NextResponse.json({ error: 'stats failed' }, { status: 500 })
    return NextResponse.json({ stats: data })
  }

  // ?export=csv → download the full roster as CSV (UTF-8 BOM for Excel)
  if (url.searchParams.get('export')) {
    const { data } = await service.from('customers').select(LIST_COLS).order('created_at', { ascending: true }).limit(10000)
    const rows = (data ?? []) as Record<string, unknown>[]
    const csv = [CSV_COLS.join(','), ...rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n')
    return new NextResponse('﻿' + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ayeka-customers-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  }

  // ?id=… → one customer + history
  const id = url.searchParams.get('id')
  if (id) {
    const [{ data: customer }, { data: visits }, { data: redemptions }, { data: adjustments }] = await Promise.all([
      service.from('customers').select(LIST_COLS).eq('id', id).single(),
      service.from('visit_logs').select('id, points_awarded, visit_timestamp').eq('customer_id', id).order('visit_timestamp', { ascending: false }).limit(20),
      service.from('reward_redemptions').select('id, points_deducted, redeemed_at, reward_id').eq('customer_id', id).order('redeemed_at', { ascending: false }).limit(20),
      service.from('point_adjustments').select('id, delta, reason, created_at').eq('customer_id', id).order('created_at', { ascending: false }).limit(20),
    ])
    if (!customer) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({ customer, visits: visits ?? [], redemptions: redemptions ?? [], adjustments: adjustments ?? [] })
  }

  // list (search + pagination)
  const q = (url.searchParams.get('q') ?? '').replace(/[,()\\%]/g, '').trim()
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, 100)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  let query = service.from('customers').select(LIST_COLS, { count: 'exact' })
  if (q) query = query.or(`email.ilike.%${q}%,phone.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
  query = query.order('last_visit_at', { ascending: false, nullsFirst: false }).range(offset, offset + limit - 1)

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: 'list failed' }, { status: 500 })
  return NextResponse.json({ customers: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as { customerId?: string; delta?: number; reason?: string } | null
  const customerId = body?.customerId
  const delta = Math.trunc(Number(body?.delta))
  const reason = body?.reason?.trim() || null

  if (!customerId) return NextResponse.json({ error: 'חסר לקוח' }, { status: 400 })
  if (!Number.isFinite(delta) || delta === 0) return NextResponse.json({ error: 'הזן מספר נקודות (חיובי או שלילי)' }, { status: 400 })
  if (Math.abs(delta) > 100000) return NextResponse.json({ error: 'ערך גדול מדי' }, { status: 400 })

  const { data, error } = await auth.service.rpc('apply_point_adjustment', {
    p_customer_id: customerId, p_delta: delta, p_reason: reason, p_actor: auth.userId,
  })
  if (error) return NextResponse.json({ error: 'העדכון נכשל' }, { status: 500 })
  return NextResponse.json({ points: data })
}
