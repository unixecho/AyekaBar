import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireDev } from '@/lib/owner/guard'
import {
  SETTINGS_TAG,
  TABLE_ORDERING_ENABLED, TABLE_ORDERING_ENABLED_DEFAULT,
  WAITER_CALL_ENABLED, WAITER_CALL_ENABLED_DEFAULT,
} from '@/lib/settings/keys'

// The developer's in-development switches (/owner/dev).
//
// WHY THIS IS NOT /api/owner/menu-cart. That route is the general manager's
// (menu editors), and its own comment is explicit that the Phase-2/3 switches
// are refused there: "they become writable in the same change that ships the
// thing they gate". This is that change for the waiter call — and the
// authority to turn it on is the developer's, not the menu's. Customer-facing
// behaviour that is being TESTED is not a lever for the people who run the bar
// night to night until the developer says it is ready.
//
// Only `waiterCallEnabled` is writable. `tableOrderingEnabled` (Phase 2, a
// cart submitted to the waiter after a 6-digit code) has no endpoint behind it
// yet, so it is returned read-only and PATCH refuses it — the same rule, kept.
//
// Writes go through the service role after the guard, like every settings write
// here (app_settings has no write policy). `updated_by`/`updated_at` are the
// record of who flipped it and when.

const FLAG_KEYS = [WAITER_CALL_ENABLED, TABLE_ORDERING_ENABLED]

export async function GET() {
  const auth = await requireDev()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('app_settings')
    .select('key, value, updated_at')
    .in('key', FLAG_KEYS)
  if (error) return NextResponse.json({ error: 'טעינת ההגדרות נכשלה' }, { status: 500 })

  const row = (key: string) => data?.find((r) => r.key === key)
  return NextResponse.json({
    waiterCallEnabled: (row(WAITER_CALL_ENABLED)?.value as boolean | undefined) ?? WAITER_CALL_ENABLED_DEFAULT,
    waiterCallUpdatedAt: row(WAITER_CALL_ENABLED)?.updated_at ?? null,
    tableOrderingEnabled: (row(TABLE_ORDERING_ENABLED)?.value as boolean | undefined) ?? TABLE_ORDERING_ENABLED_DEFAULT,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireDev()
  if (!auth.ok) return auth.res

  const body = (await request.json().catch(() => null)) as { waiterCallEnabled?: unknown } | null
  if (!body || typeof body.waiterCallEnabled !== 'boolean') {
    return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })
  }

  const { data, error } = await auth.service
    .from('app_settings')
    .upsert({
      key: WAITER_CALL_ENABLED,
      value: body.waiterCallEnabled,
      is_public: true, // the signed-out /menu page reads it before rendering
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    }, { onConflict: 'key' })
    .select('value, updated_at')
    .single()
  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })

  // The menu and POST /api/table/call both read this through the tagged cache.
  revalidateTag(SETTINGS_TAG)

  return NextResponse.json({ waiterCallEnabled: data.value === true, waiterCallUpdatedAt: data.updated_at })
}
