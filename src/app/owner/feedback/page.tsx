import { isOp } from '@/lib/staff/access'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import OwnerHeader from '@/components/OwnerHeader'
import SignOutButton from '@/components/SignOutButton'
import FeedbackInbox from '@/components/FeedbackInbox'

// The owner's feedback queue (PLAN_CUSTOMER_FEEDBACK.md §5). The dashboard's
// `feedback-new` signal deep-links here, and — like the accessibility
// statement — there is also a permanent tile on the dashboard grid, because
// the signal correctly disappears once nothing is unread and a surface you
// can only reach while it is complaining is a surface you cannot revisit.
//
// OP only, re-checked server-side even though middleware already gates
// /owner/feedback (it is in OP_ONLY_PREFIXES). Defense in depth, same as
// every other page in this directory.

export default async function OwnerFeedbackPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supabase
    .from('staff')
    .select('role, badge')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!isOp(me)) redirect('/no-access')

  return (
    <main id="main" tabIndex={-1} style={{ minHeight: '100dvh', padding: '24px 20px', maxWidth: 560, margin: '0 auto' }}>
      <OwnerHeader backHref="/owner/dashboard" right={<SignOutButton />} />
      <div className="rise" style={{ animationDelay: '140ms' }}>
        <FeedbackInbox />
      </div>
    </main>
  )
}
