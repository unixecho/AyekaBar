import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'אייכה · בר — מועדון נאמנות',
  description: 'מועדון הנאמנות של אייכה בר — כל ביקור = נקודה',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ background: 'var(--bg)', color: 'var(--text)', minHeight: '100dvh' }}>
        {children}
      </body>
    </html>
  )
}
