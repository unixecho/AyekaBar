import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// Only pages a stranger can open and that are worth finding. Keep in step with robots.ts.
const PAGES: { path: string; priority: number }[] = [
  { path: '/', priority: 1 },
  { path: '/menu', priority: 0.9 },
  { path: '/loyalty', priority: 0.6 },
  { path: '/privacy', priority: 0.3 },
  { path: '/cookies', priority: 0.3 },
  { path: '/accessibility', priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, priority }) => ({ url: `${SITE_URL}${path}`, priority }))
}
