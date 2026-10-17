import type { Metadata } from 'next'
import CookiesView from '@/components/privacy/CookiesView'
import { getSiteLanguages } from '@/lib/settings/server'
import { pageShare } from '@/lib/site'

export const metadata: Metadata = pageShare(
  'עוגיות ואחסון · אייכה בר',
  'מה האתר של אייכה בר שומר על המכשיר שלך, למה, לכמה זמן, ואיך מוחקים את זה.',
  '/cookies',
)

// What the site keeps on a visitor's device — see components/privacy/CookiesView.tsx
// and lib/privacy/registry.ts. Public: it is in no protected prefix and behind no
// switch, because a notice a visitor has to sign in to read is not a notice.
//
// The only thing read on the server is which languages the owner currently offers
// (/owner/languages), exactly as the portal and the menu do; the language the
// visitor chose lives in their browser, so the view picks it up there.
export default async function CookiesPage() {
  const languages = await getSiteLanguages()
  return <CookiesView languages={languages} />
}
