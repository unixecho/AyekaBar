import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'אייכה · בר',
  description: 'אייכה בר — חריש · תפריט דיגיטלי ומועדון נאמנות',
  icons: {
    icon: '/assets/favicon.svg',
    apple: '/assets/apple-touch-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ color: 'var(--text)', minHeight: '100dvh' }}>
        {children}
      </body>
    </html>
  )
}
