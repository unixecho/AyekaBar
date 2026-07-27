import Portal from '@/components/Portal'
import { getLoyaltyEnabled, getPortalLinks } from '@/lib/settings/server'

export default async function HomePage() {
  const [loyaltyEnabled, links] = await Promise.all([getLoyaltyEnabled(), getPortalLinks()])
  return <Portal loyaltyEnabled={loyaltyEnabled} links={links} />
}
