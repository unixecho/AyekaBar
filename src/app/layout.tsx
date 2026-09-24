import type { Metadata } from 'next'
import './globals.css'
import PageTransitions from '@/components/PageTransitions'
import { A11yWidget } from 'a11y-widget'

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
        {/* #a11y-scope wraps EVERY page's content, and is the ONLY thing the
            accessibility widget below is ever allowed to apply a CSS
            `filter` to (contrast/grayscale/invert) — never <html> or <body>.
            See the a11y-widget package's README ("Integration contract") for
            the full containing-block reasoning; the short version is that
            `filter` has the same silent hazard for `position: fixed`
            descendants that `transform` already does (documented twice
            elsewhere in this codebase — CartFab.tsx, ModalPortal.tsx), so
            anything filtered has to sit OUTSIDE the widget's own portalled
            UI, not wrap it. */}
        <div id="a11y-scope">{children}</div>
        {/* The shared accessibility widget (github.com/unixecho/a11y-widget)
            — extracted 2026-09-24 from this file's own former in-house build
            (src/components/a11y, src/lib/a11y) once Sarcafe-Portal's
            independently-maintained copy of the same widget had already
            drifted from it. Both apps and any future one now depend on the
            same package instead of re-implementing it, so a fix lands
            everywhere at once. `storageKey` is this app's PRE-EXISTING
            localStorage key, passed through deliberately so migrating onto
            the package did not reset visitors' already-saved preferences.
            Bottom-right corner (the package's own default) — the spot
            Negishot occupied until it was removed below. Portalled to
            <body> by its own launcher/panel, so it renders outside
            #a11y-scope and is never itself affected by the filter it
            controls. */}
        <A11yWidget config={{ storageKey: 'ayeka.a11y.prefs.v1' }} />
        {/* Negishot (negishot.co.il) REMOVED 2026-09-12 on the owner's
            explicit instruction, replaced by the in-house widget above.
            At the time of that removal, no one other than the author had
            verified the site with a real screen reader — flagged plainly to
            the owner alongside the change rather than silently proceeding as
            if that gate had been met. A full keyboard-only pass and a dated
            statement (standard/what was implemented/what was tested/a
            contact route) were done first. If Negishot is ever reinstated,
            the tag was:
            <Script src="https://negishot.co.il/cdn/widget.php?code=NGS_160D202C7B8B" strategy="afterInteractive" /> */}
      </body>
    </html>
  )
}
