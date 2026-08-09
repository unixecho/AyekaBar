/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'xdvjhhgmrmrfccgdnnja.supabase.co',
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
        ],
      },
    ]
  },
}

export default nextConfig