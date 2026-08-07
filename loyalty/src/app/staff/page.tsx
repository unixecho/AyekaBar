import { redirect } from 'next/navigation'

// Sign-in moved to the single /login door on 2026-08-07. Kept as a redirect —
// staff may have this bookmarked on a shared bar device.
export default function StaffSignInRedirect() {
  redirect('/login')
}
