import Portal from '@/components/Portal'
import {
  getLoyaltyEnabled, getLoyaltyVisible, getPortalLinks, getPortalReviews,
  getCustomerFeedbackEnabled,
} from '@/lib/settings/server'

export default async function HomePage() {
  const [loyaltyEnabled, loyaltyVisible, links, reviews, feedbackEnabled] = await Promise.all([
    getLoyaltyEnabled(),
    getLoyaltyVisible(),
    getPortalLinks(),
    getPortalReviews(),
    getCustomerFeedbackEnabled(),
  ])
  return (
    <Portal
      loyaltyEnabled={loyaltyEnabled}
      loyaltyVisible={loyaltyVisible}
      links={links}
      reviews={reviews}
      feedbackEnabled={feedbackEnabled}
    />
  )
}
