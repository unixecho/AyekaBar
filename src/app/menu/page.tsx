import { fetchMenu } from '@/lib/menu/fetch'
import { getCartActionFlags, getMenuCartEnabled, getCustomerFeedbackEnabled } from '@/lib/settings/server'
import MenuView from '@/components/MenuView'

// Always render fresh from the published menu (owner may publish mid-service).
export const dynamic = 'force-dynamic'

export default async function MenuPage() {
  // Four reads, one round trip's worth of latency: the menu is a real query,
  // the settings reads go through the tagged, 60s-cached settings fetch and
  // are shared across every request, so they cost effectively nothing here.
  const [menu, cartEnabled, cartActions, feedbackEnabled] = await Promise.all([
    fetchMenu(),
    getMenuCartEnabled(),
    getCartActionFlags(),
    getCustomerFeedbackEnabled(),
  ])
  return <MenuView initial={menu} cartEnabled={cartEnabled} cartActions={cartActions} feedbackEnabled={feedbackEnabled} />
}
