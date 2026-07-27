import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireOwner } from '@/lib/owner/guard'
import {
  LOYALTY_ENABLED, LOYALTY_ENABLED_DEFAULT,
  PORTAL_LINKS, PORTAL_LINKS_DEFAULT, type PortalLinkKey,
  SETTINGS_TAG,
} from '@/lib/settings/keys'

// Owner-only feature switches (public.app_settings). Public read happens
// through RLS elsewhere; writes go through the service role here.

const PORTAL_LINK_KEYS = Object.keys(PORTAL_LINKS_DEFAULT) as PortalLinkKey[]

export async function GET() {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const { data, error } = await auth.service
    .from('app_settings')
    .select('key, value, updated_at')
    .in('key', [LOYALTY_ENABLED, PORTAL_LINKS])

  if (error) return NextResponse.json({ error: 'טעינת ההגדרות נכשלה' }, { status: 500 })

  const loyaltyRow = data?.find((r) => r.key === LOYALTY_ENABLED)
  const linksRow = data?.find((r) => r.key === PORTAL_LINKS)

  return NextResponse.json({
    loyaltyEnabled: (loyaltyRow?.value as boolean | undefined) ?? LOYALTY_ENABLED_DEFAULT,
    updatedAt: loyaltyRow?.updated_at ?? null,
    portalLinks: { ...PORTAL_LINKS_DEFAULT, ...(linksRow?.value as Partial<Record<PortalLinkKey, string>> | undefined) },
    portalLinksUpdatedAt: linksRow?.updated_at ?? null,
  })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireOwner()
  if (!auth.ok) return auth.res

  const body = await request.json().catch(() => null) as
    { loyaltyEnabled?: unknown; portalLinks?: unknown } | null

  if (body && 'loyaltyEnabled' in body) {
    if (typeof body.loyaltyEnabled !== 'boolean') {
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

  if (body && 'portalLinks' in body) {
    const links = body.portalLinks
    if (typeof links !== 'object' || links === null) {
      return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })
    }
    const input = links as Record<string, unknown>
    const next: Record<PortalLinkKey, string> = { ...PORTAL_LINKS_DEFAULT }
    for (const key of PORTAL_LINK_KEYS) {
      const value = input[key]
      if (value === undefined) continue
      if (typeof value !== 'string') {
        return NextResponse.json({ error: `קישור לא תקין: ${key}` }, { status: 400 })
      }
      const trimmed = value.trim()
      if (!/^https:\/\/.+/i.test(trimmed)) {
        return NextResponse.json({ error: `הקישור חייב להתחיל ב-https:// (${key})` }, { status: 400 })
      }
      next[key] = trimmed
    }

    const { data, error } = await auth.service
      .from('app_settings')
      .upsert({
        key: PORTAL_LINKS,
        value: next,
        is_public: true, // the signed-out portal renders these buttons
        updated_at: new Date().toISOString(),
        updated_by: auth.userId,
      }, { onConflict: 'key' })
      .select('value, updated_at')
      .single()

    if (error) return NextResponse.json({ error: 'שמירה נכשלה' }, { status: 500 })

    revalidateTag(SETTINGS_TAG)

    return NextResponse.json({
      portalLinks: data.value as Record<PortalLinkKey, string>,
      updatedAt: data.updated_at,
    })
  }

  return NextResponse.json({ error: 'ערך לא תקין' }, { status: 400 })
}
