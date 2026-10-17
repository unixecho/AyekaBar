import type { Metadata } from 'next'
import PrivacyView from '@/components/privacy/PrivacyView'
import { getSiteLanguages } from '@/lib/settings/server'
import { pageShare } from '@/lib/site'

export const metadata: Metadata = pageShare(
  'מדיניות פרטיות · אייכה בר',
  'איזה מידע נשמר על מי שמשתמש באתר של אייכה בר ובמועדון הנאמנות, למה, לכמה זמן, ואיך מוחקים או מורידים אותו.',
  '/privacy',
)

// Public: in no protected prefix and behind no switch. See lib/privacy/policy.ts for what is
// still needed from the owner (the legal name and a contact for requests).
export default async function PrivacyPage() {
  return <PrivacyView languages={await getSiteLanguages()} />
}
