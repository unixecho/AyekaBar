/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        // The live project, migrated to Frankfurt 2026-08-09 (see
        // MIGRATION_PLAN.md / HANDOFF.md). This used to point at
        // xdvjhhgmrmrfccgdnnja.supabase.co, the old pre-migration Tokyo
        // project — stale since the cutover; nothing should be resolving
        // image URLs against it any more.
        hostname: 'uemnappyzjqntildlhlr.supabase.co',
      },
    ],
  },

  // Baseline hardening. The owner/staff dashboards perform privileged actions
  // (point adjustments, staff grants, the loyalty switch), so they must never
  // be frameable by another site — a transparent iframe over a "confirm"
  // button is otherwise a one-click privileged action.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Keeps the check-in token in /checkin?token=… out of the Referer
          // header on cross-origin navigation.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Tell the browser to never speak to this host over plain HTTP
          // again, even if someone types http:// or an old link points at
          // it — 2 years, applies to subdomains too, eligible for the
          // browser preload list. Vercel already terminates/redirects to
          // TLS at the edge; this is the client-side backstop so a
          // downgrade attempt never even reaches the network.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
}

export default nextConfig