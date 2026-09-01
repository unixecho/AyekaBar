import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireMenuEditor } from '@/lib/owner/guard'
import { logAudit } from '@/lib/owner/audit'
import {
  SETTINGS_TAG,
  MENU_CART_ENABLED, MENU_CART_ENABLED_DEFAULT,
  TABLE_ORDERING_ENABLED, TABLE_ORDERING_ENABLED_DEFAULT,
  WAITER_CALL_ENABLED, WAITER_CALL_ENABLED_DEFAULT,
} from '@/lib/settings/keys'

// The digital menu's cart switch.
//
// ITS OWN ROUTE RATHER THAN A BRANCH IN /api/owner/settings, for one reason:
// that route is `requireOwner()` end to end, and this is a MENU surface — the
// general manager runs the menu without holding full admin (`canEditMenu`),
// exactly as they do Happy Hour and menu versions. Widening the shared
// settings route's guard to let a GM in would also let them at loyalty,
// portal links and the OMS demo switch. Precedent: /api/owner/happy-hour,
// which is its own route for the same reason.
//
// Writes go through the service role after the guard, same as every other
// settings write in this app — `app_settings` has no write policy at all.

export async function GET() {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('app_settings')
    .select('key, value, updated_at')
    .in('key', [MENU_CART_ENABLED, TABLE_ORDERING_ENABLED, WAITER_CALL_ENABLED])

  if (error) return NextResponse.json({ error: 'טעינת ההגדרות נכשלה' }, { status: 500 })

  const row = (key: string) => data?.find((r) => r.key === key)
  const cart = row(MENU_CART_ENABLED)

  return NextResponse.json({
    menuCartEnabled: (cart?.value as boolean | undefined) ?? MENU_CART_ENABLED_DEFAULT,
    updatedAt: cart?.updated_at ?? null,
    // Read-only here. There is nothing behind these two yet, so the card shows
    // them as "בקרוב" rather than offering a switch that changes nothing —
    // and PATCH below deliberately refuses to write them (see its own note).
    tableOrderingEnabled:
      (row(TABLE_ORDERING_ENABLED)?.value as boolean | undefined) ?? TABLE_ORDERING_ENABLED_DEFAULT,
    waiterCallEnabled:
      (row(WAITER_CALL_ENABLED)?.value as boolean | undefined) ?? WAITER_CALL_ENABLED_DEFAULT,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireMenuEditor()
  if (!auth.ok) return auth.res

  const body = (await request.json().catch(() => null)) as { menuCartEnabled?: unknown } | null

  // Only ONE field is writable through this route, on purpose. The Phase-2/3
  // switches are not accepted even from an authenticated general manager:
  // turning on a button whose endpoint does not exist yet can only produce a
  // customer tapping something that fails. They become writable in the same
  // change that ships the thing they gate, not before.
  if (!body || typeof body.menuCartEnabled !== 'boolean') {
    return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })
  }

  const { data, error } = await auth.service
    .from('app_settings')
    .upsert({
      key: MENU_CART_ENABLED,
      value: body.menuCartEnabled,
      is_public: true, // the signed-out /menu page reads this before rendering
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    }, { onConflict: 'key' })
    .select('value, updated_at')
    .single()

  if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })

  // /menu reads this through the tagged, cached settings fetch — bust it so
  // the switch reaches customers already sitting with the page open on their
  // next navigation rather than up to 60s later.
  revalidateTag(SETTINGS_TAG)

  // No-ops until migration 048 widens menu_audit's action CHECK to accept
  // this value; logAudit swallows the rejection by design ("a missing log
  // line is better than a change that appears to have failed"), so this is
  // written now and simply starts recording once the SQL is applied.
  await logAudit(
    auth.service,
    auth.userId,
    'menu_cart.update',
    body.menuCartEnabled ? 'הפעיל את עגלת ההזמנה בתפריט' : 'כיבה את עגלת ההזמנה בתפריט',
    { enabled: body.menuCartEnabled },
  )

  return NextResponse.json({
    menuCartEnabled: data.value as boolean,
    updatedAt: data.updated_at,
  })
}
