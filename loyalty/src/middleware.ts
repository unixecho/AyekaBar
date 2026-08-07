import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { LOYALTY_ENABLED } from '@/lib/settings/keys'
import { isOp, canEditMenu, OP_ONLY_PREFIXES, MENU_EDITOR_PREFIX } from '@/lib/staff/access'

const PROTECTED_ROUTES = [
  '/customer/dashboard',
  '/staff/dashboard',
  MENU_EDITOR_PREFIX,
  ...OP_ONLY_PREFIXES,
]

// Everything that only makes sense when the loyalty club is live. While the
// owner keeps it switched off (app_settings.loyalty_enabled = false) these
// bounce to /loyalty, which renders the "coming soon" screen. /owner/* is
// deliberately NOT in here — the owner still manages rewards, customers and
// the switch itself while the club is dark.
// NOTE: '/staff' is deliberately absent. Gating it meant STAFF COULD NOT SIGN
// IN AT ALL while the club was off — the sign-in page itself was redirected to
// the coming-soon screen, so it looked like their accounts were broken. The
// staff dashboard shows a "club is off" state instead of the QR code.
const LOYALTY_ROUTES = ['/customer', '/checkin']

const inSection = (pathname: string, root: string) =>
  pathname === root || pathname.startsWith(`${root}/`)

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // ---- loyalty club switch (checked before auth, so a dark club shows the
  // "coming soon" page instead of a sign-in form) ----
  if (LOYALTY_ROUTES.some((route) => inSection(pathname, route))) {
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', LOYALTY_ENABLED)
      .maybeSingle()

    // Fails closed: anything other than an explicit `true` (missing row, read
    // error, table not migrated yet) keeps the club dark.
    if (setting?.value !== true) {
      const url = request.nextUrl.clone()
      url.pathname = '/loyalty'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route))

  if (isProtected && !user) {
    // Redirect to appropriate sign-in page based on route
    const redirectTo = pathname.startsWith('/staff')
      ? '/staff'
      : pathname.startsWith('/owner')
      ? '/owner'
      : '/customer'

    const url = request.nextUrl.clone()
    url.pathname = redirectTo
    return NextResponse.redirect(url)
  }

  // Authenticated isn't authorized: with Google sign-in open to any account,
  // staff/owner dashboards additionally require a public.staff row
  // (RLS lets each user read only their own row).
  const staffProtected = pathname.startsWith('/staff/dashboard')
  const editorProtected = pathname.startsWith(MENU_EDITOR_PREFIX)
  const opProtected = OP_ONLY_PREFIXES.some((p) => pathname.startsWith(p))
  const ownerProtected = editorProtected || opProtected

  if (user && (staffProtected || ownerProtected)) {
    const { data: staffRow } = await supabase
      .from('staff')
      .select('role, badge')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    // No linked row yet? The owner may have authorized this person by email
    // before they ever signed in — claim_staff_invite() matches the signed-in
    // Google address against pending invites and links the row. Only runs on
    // the miss path, so it costs nothing for established staff.
    let row: { role?: string | null; badge?: string | null } | null = staffRow
    if (!staffRow) {
      const { data: claimed } = await supabase.rpc('claim_staff_invite')
      if (claimed) {
        const { data: fresh } = await supabase
          .from('staff').select('role, badge').eq('auth_user_id', user.id).maybeSingle()
        row = fresh ?? { role: claimed as string, badge: null }
      } else {
        row = null
      }
    }

    // The editor is open to the general manager without OP; the rest of the
    // owner panel is not.
    const denied =
      !row
      || (editorProtected && !canEditMenu(row))
      || (opProtected && !isOp(row))

    if (denied) {
      // Authenticated but not authorized — send back to the sign-in page with a
      // flag so it can explain (rather than a silent bounce to home).
      const url = request.nextUrl.clone()
      url.pathname = ownerProtected ? '/owner' : '/staff'
      url.search = '?denied=1'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
