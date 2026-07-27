import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

// After Google sign-in we route by the user's actual role, not by a query
// param — an owner always lands on the owner dashboard, staff on the staff
// dashboard, everyone else on the customer dashboard.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      let dest = '/customer/dashboard'
      if (user) {
        // Link any pending invite the owner created for this email before the
        // person's first sign-in, then route by the resulting role. Returns the
        // existing role unchanged when there's nothing to claim.
        const { data: claimed } = await supabase.rpc('claim_staff_invite')
        let role = claimed as string | null

        if (!role) {
          const { data: staff } = await supabase
            .from('staff')
            .select('role')
            .eq('auth_user_id', user.id)
            .maybeSingle()
          role = staff?.role ?? null
        }

        if (role === 'owner') dest = '/owner/dashboard'
        else if (role === 'staff') dest = '/staff/dashboard'
      }
      return NextResponse.redirect(`${origin}${dest}`)
    }
  }

  return NextResponse.redirect(`${origin}/customer?error=auth`)
}
