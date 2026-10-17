import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

// Public pages are open; everything behind a login, every API route and the one-time links are not.
// (robots.txt is a request to well-behaved crawlers, not a lock — the real gates are the middleware
// and each route's own check.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/owner', '/staff', '/customer', '/api', '/auth', '/join', '/checkin', '/login', '/no-access'],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
