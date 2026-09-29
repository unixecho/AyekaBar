import { fetchMenu } from '@/lib/menu/fetch'
import { getCartActionFlags, getMenuCartEnabled, getCustomerFeedbackEnabled, getSiteLanguages } from '@/lib/settings/server'
import MenuView from '@/components/MenuView'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'תפריט · אייכה בר' }

// Always render fresh from the published menu (owner may publish mid-service).
export const dynamic = 'force-dynamic'

export default async function MenuPage() {
  // Five reads, one round trip's worth of latency: the menu is a real query,
  // the settings reads go through the tagged, 60s-cached settings fetch and
  // are shared across every request, so they cost effectively nothing here.
  const [menu, cartEnabled, cartActions, feedbackEnabled, languages] = await Promise.all([
    fetchMenu(),
    getMenuCartEnabled(),
    getCartActionFlags(),
    getCustomerFeedbackEnabled(),
    getSiteLanguages(),
  ])
  return <MenuView initial={menu} cartEnabled={cartEnabled} cartActions={cartActions} feedbackEnabled={feedbackEnabled} languages={languages} />
}
