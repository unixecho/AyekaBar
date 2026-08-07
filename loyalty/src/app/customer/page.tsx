import { redirect } from 'next/navigation'

// Sign-in moved to the single /login door on 2026-08-07. Still reached from
// the loyalty landing page and from any QR printed before the change.
export default function CustomerSignInRedirect() {
  redirect('/login')
}
