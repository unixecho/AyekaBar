import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'
import { isOp, canEditMenu } from '@/lib/staff/access'
import { getLoyaltyEnabled } from '@/lib/settings/server'

// After Google sign-in we route by the user's actual ACCESS LEVEL, not by a
// query param and not by `role` alone.
//
// Routing on `role` was the bug behind "only OP can sign in": a co-owner
// carrying just the בעלים badge, and the general manager, both have
// role = 'staff', so they were sent to /staff/dashboard — which sits behind
// the loyalty switch and bounced them to the coming-soon page. It looked like
// sign-in was broken when they had in fact signed in fine and been sent
// somewhere they weren't allowed to be.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Optional return-path override — used by /checkin so a customer lands
  // straight back at their QR check-in instead of their normal dashboard.
  // Only ever a same-origin relative path: never `//host/...` (protocol-
  // relative) or an absolute URL, or this becomes an open redirect riding on
  // the back of a real Google login.
  const next = safeNext(searchParams.get('next'))

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      let dest = next ?? '/customer/dashboard'
      if (user) {
        // Link any pending invite the owner created for this email before the
        // person's first sign-in. Safe to call every time — it's a no-op once
        // linked, and returns the caller's role.
        await supabase.rpc('claim_staff_invite')

        const { data: staff } = await supabase
          .from('staff')
          .select('role, badge')
          .eq('auth_user_id', user.id)
          .maybeSingle()

        if (staff) {
          // Send everyone to the most capable place they're actually allowed
          // in, so nobody lands on a page that immediately denies them —
          // unless a specific return path was requested (e.g. /checkin).
          if (next) dest = next
          else if (isOp(staff)) dest = '/owner/dashboard'
          else if (canEditMenu(staff)) dest = '/owner/editor'
          else dest = '/staff/dashboard'
        } else if (!next && !(await getLoyaltyEnabled())) {
          // Not staff, and the loyalty club isn't running — there is nothing
          // here for this account. Say so, with the admin's number, rather than
          // bouncing them through a customer dashboard that redirects again.
          dest = '/no-access'
        }
      }
      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  return NextResponse.redirect(`${origin}/customer?error=auth`)
}

function safeNext(value: string | null): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('://')) return null
  return value
}
