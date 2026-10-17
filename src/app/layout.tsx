import type { Metadata } from 'next'
import { Rubik } from 'next/font/google'
import './globals.css'
import PageTransitions from '@/components/PageTransitions'
import IntroGate from '@/components/intro/IntroGate'
import LegacyCleanup from '@/components/privacy/LegacyCleanup'
import A11yGate from '@/components/A11yGate'
import SiteAnalytics from '@/components/SiteAnalytics'
import { SITE_URL, SHARE_IMAGE, SITE_DESCRIPTION } from '@/lib/site'

// The one typeface, SELF-HOSTED (2026-10-04). It used to be an @import of Google
// Fonts at the top of globals.css, which made every visitor's browser contact
// Google — their IP address and the page they were on went to a company that is
// not our hosting provider — before a single word rendered. next/font downloads
// the files once, at build time, and serves them from our own domain: same
// typeface, same weights (it is a variable font, 300–900), no third party, and one
// fewer thing the /cookies page would have to confess. The three subsets are the
// site's three languages; the browser fetches only the ones a page actually uses.
// scripts/check-privacy.mjs fails if a remote font import comes back.
const rubik = Rubik({
  subsets: ['hebrew', 'latin', 'arabic'],
  display: 'swap',
  variable: '--font-rubik',
})

// Pages that do not set their own title/description inherit these, and every page inherits the
// share image (a page that sets its own openGraph must repeat `images` — Next replaces, not merges).

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'אייכה בר · חריש',
  description: SITE_DESCRIPTION,
  applicationName: 'אייכה בר',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/assets/favicon.svg', type: 'image/svg+xml' },
      { url: '/assets/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/assets/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: 'אייכה בר',
    locale: 'he_IL',
    title: 'אייכה בר · חריש',
    description: SITE_DESCRIPTION,
    url: '/',
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'אייכה בר · חריש',
    description: SITE_DESCRIPTION,
    images: [SHARE_IMAGE.url],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={rubik.variable}>
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
        {/* The portal's intro (2026-10-03). A SIBLING of #a11y-scope, never
            inside it, and not under template.tsx either: both of those can be
            the containing block for `position: fixed`, which would size the
            overlay to the page instead of the screen. In the layout it is also
            in the server-rendered HTML, so it covers the portal from the very
            first frame, and it plays once per document load (a layout survives
            client navigation) — on `/` only, see lib/intro/config.ts.
            <IntroGate> is the owner's on/off switch (/owner/intro): it reads
            the setting on the server and renders the overlay only when it is
            on, time-boxed so a slow settings read can never slow a page. */}
        <IntroGate />
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
        {/* 2026-10-13: mounted through <A11yGate>, which keeps the widget off
            everything under /owner and /staff (the dashboards) and tears down
            whatever it had applied on the way in. The config above moved with
            it — same storage key, same statement link. */}
        <A11yGate />
        {/* Renders nothing. Removes what older versions of the site left in the
            visitor's browser — Negishot's cookie and storage keys above all — on
            whichever page they happen to land first. See lib/privacy/registry.ts. */}
        <LegacyCleanup />
        {/* Anonymous, cookieless visit counting (Vercel Web Analytics). Renders nothing; private pages and
            visitors who send Do Not Track / GPC are never counted — lib/analytics.ts, declared on /privacy and /cookies. */}
        <SiteAnalytics />
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
