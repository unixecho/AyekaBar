import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'

// Receipts for the owner dashboard (PLAN_OMS_V2.md item 13 — Johnathan,
// 2026-08-15: "all receipts need to be easily accessible to the owner
// dashboard"). Service-role read of waiter_orders/waiter_order_items —
// this repo has never had a UI for order data before; see STAFF_APP.md's
// entry the day this shipped for why that's a real, logged boundary
// change, not an oversight.
//
// ?id=<orderId>   → one order, fully itemized (a receipt)
// ?limit&offset   → recent closed orders (paid/void), summary rows only

const RECEIPT_COLS =
  'id,table_id,table_number,table_label,channel,status,waiter_name,opened_at,paid_at,closed_at,bon_at,total_agorot'

export async function GET(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const { service } = auth
  const url = new URL(request.url)

  const id = url.searchParams.get('id')
  if (id) {
    const [{ data: order, error }, { data: items }, { data: guests }] = await Promise.all([
      service.from('waiter_orders').select(RECEIPT_COLS).eq('id', id).maybeSingle(),
      service
        .from('waiter_order_items')
        .select('id,item_uid,name_he,variant,unit_agorot,qty,note,category_id,category_title,status,guest_id,is_shared,seat_name,station')
        .eq('order_id', id)
        .neq('status', 'voided')
        .order('created_at', { ascending: true }),
      service.from('waiter_order_guests').select('id,seq,name').eq('order_id', id),
    ])
    if (error || !order) return NextResponse.json({ error: 'לא נמצאה קבלה' }, { status: 404 })
    return NextResponse.json({ order, items: items ?? [], guests: guests ?? [] })
  }

  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  const { data, count, error } = await service
    .from('waiter_orders')
    .select(RECEIPT_COLS, { count: 'exact' })
    .in('status', ['paid', 'void'])
    .order('closed_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: 'טעינת הקבלות נכשלה' }, { status: 500 })
  return NextResponse.json({ receipts: data ?? [], total: count ?? 0 })
}
