import { headers } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { JOIN_AUTH_ERROR, JOIN_LIMITS, isJoinToken, parsePeek } from '@/lib/staff/join'
import { peekJoin } from '@/lib/staff/join-server'
import { badgeMeta } from '@/lib/staff/badges'
import JoinWizard from '@/components/staff/JoinWizard'
import type { Metadata } from 'next'

// The onboarding wizard (2026-10-14): where a freshly created employee lands from the link the owner sent them.
//
//   /join/<token>   →   meet · connect Google · confirm · done
//
// THIS PAGE IS PUBLIC — the link IS the credential, so the page is built around not leaking it and not
// confirming anything to a stranger:
//   • `referrer: no-referrer`: the token is in the URL, and the next click is a hand-off to Google. It must never
//     ride along in a Referer header.
//   • `robots: noindex`, never cached (`force-dynamic`).
//   • What it tells a visitor with a VALID link is a first name and a job title — enough for "this is mine".
//     An invalid, expired, spent or malformed link all read as a calm dead end with a sentence, never an error.
//   • The lookup is rate-limited per IP; over the limit it shows the same calm dead end.
//
// Nothing is written here. Linking the account is the wizard's explicit "confirm" step (POST /api/join/claim),
// which takes WHO from the session, never from the page.

export const metadata: Metadata = {
  title: 'הצטרפות לצוות · אייכה בר',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}
export const dynamic = 'force-dynamic'

export default async function JoinPage({ params, searchParams }: { params: { token: string }; searchParams?: { error?: string | string[] } }) {
  const token = params.token
  const wellFormed = isJoinToken(token)

  let peek = parsePeek(null)
  let notSetUp = false
  let limited = false
  if (wellFormed) {
    const within = await checkRateLimit(
      `join-peek:ip:${clientIp({ headers: headers() })}`, JOIN_LIMITS.peek.max, JOIN_LIMITS.peek.windowSeconds)
    if (within) {
      const service = createServiceClient()
      const out = await peekJoin(service, token)
      peek = out.peek
      notSetUp = out.notSetUp
    } else {
      limited = true
    }
  }

  // Who is signed in right now, if anyone — the wizard skips the "connect" screen for them and shows which
  // account will be linked. A person who is ALREADY on the roster is told so up front rather than discovering it
  // when they press confirm.
  const { data: { user } } = await createClient().auth.getUser()
  let alreadyStaff = false
  if (user) {
    const { data: row } = await createServiceClient()
      .from('staff').select('id').eq('auth_user_id', user.id).maybeSingle()
    alreadyStaff = !!row
  }

  return (
    <JoinWizard
      token={wellFormed ? token : ''}
      status={peek.status}
      firstName={peek.firstName}
      badgeLabel={peek.badge ? badgeMeta(peek.badge, 'staff').he : null}
      signedInEmail={user?.email ?? null}
      alreadyStaff={alreadyStaff}
      notSetUp={notSetUp}
      limited={limited}
      authFailed={(Array.isArray(searchParams?.error) ? searchParams?.error[0] : searchParams?.error) === JOIN_AUTH_ERROR}
    />
  )
}
