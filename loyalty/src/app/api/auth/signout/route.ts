import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = createClient()

  const { error } = await supabase.auth.signOut()

  if (error) {
    return NextResponse.json(
      { error: 'התנתקות נכשלה' },
      { status: 500 }
    )
  }

  // Redirect to home page after sign out
  const response = NextResponse.json({ success: true })
  // Clear the Supabase auth cookie
  response.cookies.set('sb-auth-token', '', { maxAge: 0, path: '/' })

  return response
}
