import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import PageTransitions from '@/components/PageTransitions'

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
        {/* Lives in the layout, not the template, so it survives navigation
            and can settle the transition it started. */}
        <PageTransitions />
        {children}
        {/* Negishot accessibility widget (negishot.co.il) — a free overlay
            (contrast/text-size/keyboard tools for visitors), not a
            substitute for the code-level accessibility work already done
            (see globals.css's :focus-visible/--text-faint fixes) or for the
            accessibility statement at /accessibility — see PLAYBOOK.md §5
            for why both matter. Loaded at the end of body, same as any
            such widget, so it never blocks first paint. */}
        <Script src="https://negishot.co.il/cdn/widget.php?code=NGS_160D202C7B8B" strategy="afterInteractive" />
      </body>
    </html>
  )
}
