import Portal from '@/components/Portal'
import { getLoyaltyEnabled, getLoyaltyVisible, getPortalLinks, getPortalReviews } from '@/lib/settings/server'

export default async function HomePage() {
  const [loyaltyEnabled, loyaltyVisible, links, reviews] = await Promise.all([
    getLoyaltyEnabled(),
    getLoyaltyVisible(),
    getPortalLinks(),
    getPortalReviews(),
  ])
  return (
    <Portal
      loyaltyEnabled={loyaltyEnabled}
      loyaltyVisible={loyaltyVisible}
      links={links}
      reviews={reviews}
    />
  )
}
