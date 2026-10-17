// The public address of the site and the share image every page inherits.
// Kept out of layout.tsx because Next refuses extra exports from a layout.
// The live address is the www host: the bare ayeka.bar answers with a redirect to it, so canonical links,
// the sitemap and the share image all name www (checked with curl -I, 2026-10-17).
export const SITE_URL = 'https://www.ayeka.bar'

export const SHARE_IMAGE = {
  url: '/assets/og-image.png',
  width: 1200,
  height: 630,
  alt: 'אייכה בר · Ayeka Bar — Harish',
}

export const SITE_DESCRIPTION =
  'אייכה בר בחריש — תפריט דיגיטלי, מועדון נאמנות, ניווט והמלצות. Ayeka Bar, Harish: digital menu and loyalty club.'

// A page that sets its own openGraph must repeat `images` — Next replaces the object, it does not merge it.
export function pageShare(title: string, description: string, path: string) {
  return {
    title,
    description,
    openGraph: { type: 'website' as const, siteName: 'אייכה בר', locale: 'he_IL', title, description, url: path, images: [SHARE_IMAGE] },
    twitter: { card: 'summary_large_image' as const, title, description, images: [SHARE_IMAGE.url] },
    alternates: { canonical: path },
  }
}
