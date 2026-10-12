import type { Metadata } from 'next'

// The staff app's web manifest + iOS standalone hints. Web Push exists on iPhone only inside the
// home-screen app, so this is what makes "add to home screen" produce an app that can be sent alerts.
export const metadata: Metadata = {
  manifest: '/staff-manifest.json',
  appleWebApp: { capable: true, title: 'אייכה בר · צוות', statusBarStyle: 'black-translucent' },
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return children
}
