import type { Metadata } from 'next'
import Script from 'next/script'
import './globals.css'
import PageTransitions from '@/components/PageTransitions'
import A11yWidget from '@/components/a11y/A11yWidget'

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
        {/* WCAG 2.4.1 Bypass Blocks (Level A). Must be the FIRST focusable
            thing in the document, which is why it lives here rather than in
            any page. Hebrew only, deliberately: the language is chosen
            client-side after hydration, and a control that must be correct
            on the very first Tab cannot wait for that — the site's default
            and primary language is the honest choice. Every page renders a
            <main id="main"> for it to land on. */}
        <a href="#main" className="skip-link">דילוג לתוכן הראשי</a>
        {/* Lives in the layout, not the template, so it survives navigation
            and can settle the transition it started. */}
        <PageTransitions />
        {/* #a11y-scope wraps EVERY page's content, and is the ONLY thing
            the in-house accessibility widget below is ever allowed to apply
            a CSS `filter` to (contrast/grayscale/invert) — never <html> or
            <body>. See src/lib/a11y/apply.ts's header for the full
            containing-block reasoning; the short version is that `filter`
            has the same silent hazard for `position: fixed` descendants
            that `transform` already does (documented twice elsewhere in
            this codebase — CartFab.tsx, ModalPortal.tsx), so anything
            filtered has to sit OUTSIDE the widget's own portalled UI, not
            wrap it. */}
        <div id="a11y-scope">{children}</div>
        {/* The in-house accessibility widget (PLAN_ACCESSIBILITY.md §3).
            Phase 1 ("build, internal-only") — mounted here, alongside
            Negishot below, NOT replacing it yet. Portalled to <body> by its
            own launcher/panel, so it renders outside #a11y-scope and is
            never itself affected by the filter it controls. */}
        <A11yWidget />
        {/* Negishot accessibility widget (negishot.co.il) — a free overlay
            (contrast/text-size/keyboard tools for visitors), not a
            substitute for the code-level accessibility work already done
            (see globals.css's :focus-visible/--text-faint fixes) or for the
            accessibility statement at /accessibility — see PLAYBOOK.md §5
            for why both matter. Loaded at the end of body, same as any
            such widget, so it never blocks first paint. Stays in place
            until PLAN_ACCESSIBILITY.md §2's exit criteria are met — see
            that file's §3.8 for the phased plan to eventually retire it. */}
        <Script src="https://negishot.co.il/cdn/widget.php?code=NGS_160D202C7B8B" strategy="afterInteractive" />
      </body>
    </html>
  )
}
