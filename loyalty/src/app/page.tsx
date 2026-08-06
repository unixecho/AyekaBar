import Portal from '@/components/Portal'
import { getLoyaltyEnabled, getLoyaltyVisible, getPortalLinks } from '@/lib/settings/server'

export default async function HomePage() {
  const [loyaltyEnabled, loyaltyVisible, links] = await Promise.all([
    getLoyaltyEnabled(),
    getLoyaltyVisible(),
    getPortalLinks(),
  ])
  return <Portal loyaltyEnabled={loyaltyEnabled} loyaltyVisible={loyaltyVisible} links={links} />
}
