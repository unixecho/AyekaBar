import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

const PROTECTED_ROUTES = [
  '/customer/dashboard',
  '/staff/dashboard',
  '/owner/dashboard',
  '/owner/editor',
  '/owner/customers',
  '/owner/rewards',
]

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
  const ownerProtected = pathname.startsWith('/owner/dashboard') || pathname.startsWith('/owner/editor') || pathname.startsWith('/owner/customers') || pathname.startsWith('/owner/rewards')

  if (user && (staffProtected || ownerProtected)) {
    const { data: staffRow } = await supabase
      .from('staff')
      .select('role')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!staffRow || (ownerProtected && staffRow.role !== 'owner')) {
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
