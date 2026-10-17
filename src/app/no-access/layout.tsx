import type { Metadata } from 'next'

// The page itself is a client component, which cannot export metadata; this layout does it.
// Sign-in and one-time-link pages are not for search results (robots.txt also disallows them).
export const metadata: Metadata = {
  title: 'אין הרשאת גישה · אייכה בר',
  description: 'כניסה לאזור האישי של אייכה בר.',
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
