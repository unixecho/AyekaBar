import Portal from '@/components/Portal'
import { getLoyaltyEnabled } from '@/lib/settings/server'

export default async function HomePage() {
  const loyaltyEnabled = await getLoyaltyEnabled()
  return <Portal loyaltyEnabled={loyaltyEnabled} />
}
