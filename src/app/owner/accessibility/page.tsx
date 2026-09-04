import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import AccessibilityStatementEditor from '@/components/AccessibilityStatementEditor'
import { getAccessibilityStatement } from '@/lib/settings/server'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'הצהרת נגישות (ניהול) · אייכה בר' }

// The owner-facing editor for the public /accessibility statement.
// 2026-09-01: "don't show the customer any missing information... every
// missing field surfaces in the dashboard notification bar as input that
// needs to be entered — once it's done it'll be added into the
// accessibility statement automatically." This page IS the "once it's
// done" step — the dashboard signal (src/lib/owner/signals.ts) deep-links
// here.

export default async function OwnerAccessibilityPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  const statement = await getAccessibilityStatement()

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />
      <AccessibilityStatementEditor initial={statement} />
    </main>
  )
}
