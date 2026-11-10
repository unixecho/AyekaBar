import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/staff/guard'

export const dynamic = 'force-dynamic'

// The dashboard bell reads only the signed-in staff member's existing schedule inbox.
export async function GET() {
  const guard = await requireStaff()
  if (!guard.ok) return guard.res

  const { data: staff, error: staffError } = await guard.service.from('staff')
    .select('id').eq('auth_user_id', guard.userId).eq('active', true).maybeSingle()
  if (staffError || !staff) return NextResponse.json({ error: 'Notifications unavailable' }, { status: 503 })

  const [items, unread] = await Promise.all([
    guard.service.from('schedule_notifications')
      .select('id, kind, title, body, link, created_at, read_at')
      .eq('staff_id', staff.id).order('created_at', { ascending: false }).limit(40),
    guard.service.from('schedule_notifications')
      .select('id', { count: 'exact', head: true }).eq('staff_id', staff.id).is('read_at', null),
  ])
  if (items.error || unread.error || unread.count === null) {
    return NextResponse.json({ error: 'Notifications unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ notifications: items.data ?? [], unread: unread.count }, { headers: { 'Cache-Control': 'no-store' } })
}
