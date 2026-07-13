import { fetchMenu } from '@/lib/menu/fetch'
import MenuView from '@/components/MenuView'

// Always render fresh from the published menu (owner may publish mid-service).
export const dynamic = 'force-dynamic'

export default async function MenuPage() {
  const menu = await fetchMenu()
  return <MenuView initial={menu} />
}
