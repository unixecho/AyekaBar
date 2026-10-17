import type { Metadata } from 'next'
import { pageShare } from '@/lib/site'
import Portal from '@/components/Portal'
import {
  getLoyaltyEnabled, getLoyaltyVisible, getPortalLinks, getPortalReviews,
  getCustomerFeedbackEnabled, getSiteLanguages,
} from '@/lib/settings/server'

export const metadata: Metadata = pageShare(
  'אייכה בר · חריש',
  'אייכה בר בחריש — תפריט דיגיטלי, מועדון נאמנות, ניווט, ביקורות ויצירת קשר. כל מה שצריך לפני שמגיעים.',
  '/',
)

export default async function HomePage() {
  const [loyaltyEnabled, loyaltyVisible, links, reviews, feedbackEnabled, languages] = await Promise.all([
    getLoyaltyEnabled(),
    getLoyaltyVisible(),
    getPortalLinks(),
    getPortalReviews(),
    getCustomerFeedbackEnabled(),
    getSiteLanguages(),
  ])
  return (
    <Portal
      loyaltyEnabled={loyaltyEnabled}
      loyaltyVisible={loyaltyVisible}
      links={links}
      reviews={reviews}
      feedbackEnabled={feedbackEnabled}
      languages={languages}
    />
  )
}
