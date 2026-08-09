import { redirect } from 'next/navigation'

// Sign-in moved to the single /login door on 2026-08-07. Kept as a redirect
// rather than deleted: this URL is in browser histories and bookmarks, and the
// owner has typed it for weeks.
export default function OwnerSignInRedirect() {
  redirect('/login')
}
