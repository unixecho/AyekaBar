import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/owner/guard'

const BUSINESS_ID = process.env.NEXT_PUBLIC_BUSINESS_ID || '00000000-0000-0000-0000-000000000001'
const COLS = 'id, reward_name, reward_name_he, required_points, active, created_at'

export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const { data, error } = await auth.service
    .from('rewards')
    .select(COLS)
    .eq('business_id', BUSINESS_ID)
    .order('required_points', { ascending: true })
  if (error) return NextResponse.json({ error: 'load failed' }, { status: 500 })
  return NextResponse.json({ rewards: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const b = await request.json().catch(() => null) as
    { reward_name_he?: string; reward_name?: string; required_points?: number; active?: boolean } | null
  const nameHe = b?.reward_name_he?.trim()
  const points = Math.trunc(Number(b?.required_points))
  if (!nameHe) return NextResponse.json({ error: 'חסר שם פרס' }, { status: 400 })
  if (!Number.isFinite(points) || points <= 0) return NextResponse.json({ error: 'נקודות לא תקינות' }, { status: 400 })

  const { data, error } = await auth.service
    .from('rewards')
    .insert({
      business_id: BUSINESS_ID,
      reward_name_he: nameHe,
      reward_name: b?.reward_name?.trim() || nameHe,
      required_points: points,
      active: b?.active ?? true,
    })
    .select(COLS)
    .single()
  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })
  return NextResponse.json({ reward: data })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const b = await request.json().catch(() => null) as
    { id?: string; reward_name_he?: string; reward_name?: string; required_points?: number; active?: boolean } | null
  if (!b?.id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof b.reward_name_he === 'string') patch.reward_name_he = b.reward_name_he.trim()
  if (typeof b.reward_name === 'string') patch.reward_name = b.reward_name.trim()
  if (b.required_points !== undefined) {
    const p = Math.trunc(Number(b.required_points))
    if (!Number.isFinite(p) || p <= 0) return NextResponse.json({ error: 'נקודות לא תקינות' }, { status: 400 })
    patch.required_points = p
  }
  if (typeof b.active === 'boolean') patch.active = b.active
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'אין מה לעדכן' }, { status: 400 })

  const { data, error } = await auth.service
    .from('rewards').update(patch).eq('id', b.id).eq('business_id', BUSINESS_ID).select(COLS).single()
  if (error) return NextResponse.json({ error: 'עדכון נכשל' }, { status: 500 })
  return NextResponse.json({ reward: data })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res
  const b = await request.json().catch(() => null) as { id?: string } | null
  if (!b?.id) return NextResponse.json({ error: 'חסר מזהה' }, { status: 400 })
  const { error } = await auth.service.from('rewards').delete().eq('id', b.id).eq('business_id', BUSINESS_ID)
  if (error) return NextResponse.json({ error: 'מחיקה נכשלה' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
