import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireOwner } from '@/lib/owner/guard'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isFeedbackCategory, isFeedbackStatus } from '@/lib/feedback/validate'
import {
  CUSTOMER_FEEDBACK_ENABLED, CUSTOMER_FEEDBACK_ENABLED_DEFAULT, SETTINGS_TAG,
} from '@/lib/settings/keys'

// The owner's side of the feedback box: read the queue, move a row along,
// and close the box if it stops being worth having open.
//
// requireOwner() — OP only, the same gate /owner/customers and /owner/audit
// take. Not requireMenuEditor(): this is unsolicited free text from the
// public, sometimes with a contact address attached, and the general manager
// being trusted with the MENU has never implied being handed customer
// correspondence. Widening it later is one word; narrowing it after someone
// has read it is not.
//
// Errors are Hebrew sentences here, unlike the public route next door, and
// for the reason that route's header gives: this surface has exactly one
// reader and their language is Hebrew.

const LIST_COLS = 'id, category, message, contact_email, page_url, customer_id, status, resolved_at, created_at'

/** A page of the inbox. Bounded so a `?limit=100000` from a curious owner
 *  can't ask Postgres for the whole table in one response. */
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export async function GET(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const category = url.searchParams.get('category')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)

  let query = auth.service
    .from('customer_feedback')
    .select(LIST_COLS, { count: 'exact' })
  // Anything that isn't a recognised value is treated as "no filter" rather
  // than as an error: these come from the UI's own chips, and a filter that
  // 400s is a worse failure than a filter that shows everything.
  if (isFeedbackStatus(status)) query = query.eq('status', status)
  if (isFeedbackCategory(category)) query = query.eq('category', category)

  const [list, counts, setting] = await Promise.all([
    query.order('created_at', { ascending: false }).range(offset, offset + limit - 1),
    // head:true — the count without the rows. Three of them because the tab
    // labels state all three numbers at once, and a client-side count of the
    // current page would be a different (wrong) number.
    Promise.all(
      (['new', 'read', 'resolved'] as const).map((s) =>
        auth.service
          .from('customer_feedback')
          .select('id', { count: 'exact', head: true })
          .eq('status', s)
          .then((r) => [s, r.count ?? 0] as const),
      ),
    ),
    auth.service
      .from('app_settings')
      .select('value')
      .eq('key', CUSTOMER_FEEDBACK_ENABLED)
      .maybeSingle(),
  ])

  if (list.error) {
    console.error('feedback list failed:', list.error.message)
    return NextResponse.json({ error: 'טעינת המשובים נכשלה' }, { status: 500 })
  }

  return NextResponse.json({
    items: list.data ?? [],
    total: list.count ?? 0,
    counts: Object.fromEntries(counts) as Record<'new' | 'read' | 'resolved', number>,
    enabled: (setting.data?.value as boolean | undefined) ?? CUSTOMER_FEEDBACK_ENABLED_DEFAULT,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  // Keyed on the owner, not the IP: this is an authenticated route, and the
  // thing worth bounding is a runaway client loop, not an attacker.
  if (!(await checkRateLimit(`feedback-admin:${auth.userId}`, 120, 60))) {
    return rateLimitResponse()
  }

  const body = (await request.json().catch(() => null)) as
    { id?: unknown; status?: unknown; enabled?: unknown } | null
  if (!body) return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })

  // ---- The box's own on/off switch --------------------------------------
  // Lives here rather than as another branch in /api/owner/settings for the
  // same reason /api/owner/menu-cart does: the control belongs to this
  // feature's page, and this route is already gated exactly right for it.
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })
    }
    const { data, error } = await auth.service
      .from('app_settings')
      .upsert({
        key: CUSTOMER_FEEDBACK_ENABLED,
        value: body.enabled,
        is_public: true, // the signed-out portal decides whether to render the button
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      }, { onConflict: 'key' })
      .select('value')
      .single()

    if (error) {
      console.error('feedback switch failed:', error.message)
      return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })
    }

    // The portal reads this through the tagged, cached settings fetch — bust
    // it so closing the box reaches live visitors on their next navigation
    // rather than up to 60s later. The ENDPOINT is already refusing by then
    // regardless; this is about not showing a button that will fail.
    revalidateTag(SETTINGS_TAG)
    return NextResponse.json({ enabled: data.value as boolean })
  }

  // ---- Moving one row along ---------------------------------------------
  const id = body.id
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'מזהה לא תקין' }, { status: 400 })
  }
  if (!isFeedbackStatus(body.status)) {
    return NextResponse.json({ error: 'סטטוס לא תקין' }, { status: 400 })
  }

  // resolved_by/resolved_at are written by the SERVER from the guard's own
  // userId, never from the body — the row records who actually did it, not
  // who the client claimed. Moving a row back OUT of resolved clears both,
  // so a stale signature can't outlive the state it was describing.
  const resolving = body.status === 'resolved'
  const { data, error } = await auth.service
    .from('customer_feedback')
    .update({
      status: body.status,
      resolved_by: resolving ? auth.userId : null,
      resolved_at: resolving ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select(LIST_COLS)
    .maybeSingle()

  if (error) {
    console.error('feedback status update failed:', error.message)
    return NextResponse.json({ error: 'העדכון נכשל' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'המשוב לא נמצא' }, { status: 404 })

  return NextResponse.json({ item: data })
}
