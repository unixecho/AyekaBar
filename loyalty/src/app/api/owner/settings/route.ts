import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireOwner } from '@/lib/owner/guard'
import { LOYALTY_ENABLED, LOYALTY_ENABLED_DEFAULT, SETTINGS_TAG } from '@/lib/settings/keys'

// Owner-only feature switches (public.app_settings). Public read happens
// through RLS elsewhere; writes go through the service role here.

export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('app_settings')
    .select('key, value, updated_at')
    .eq('key', LOYALTY_ENABLED)
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'טעינת ההגדרות נכשלה' }, { status: 500 })

  return NextResponse.json({
    loyaltyEnabled: (data?.value as boolean | undefined) ?? LOYALTY_ENABLED_DEFAULT,
    updatedAt: data?.updated_at ?? null,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as { loyaltyEnabled?: unknown } | null
  if (typeof body?.loyaltyEnabled !== 'boolean') {
    return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })
  }

  const { data, error } = await auth.service
    .from('app_settings')
    .upsert({
      key: LOYALTY_ENABLED,
      value: body.loyaltyEnabled,
      is_public: true, // the portal reads this switch while signed out
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    }, { onConflict: 'key' })
    .select('value, updated_at')
    .single()

  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })

  // Portal + loyalty pages read this through a tagged, cached fetch — bust it
  // so the switch takes effect on the live site immediately.
  revalidateTag(SETTINGS_TAG)

  return NextResponse.json({
    loyaltyEnabled: data.value as boolean,
    updatedAt: data.updated_at,
  })
}
