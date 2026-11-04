const isProd = process.env.NODE_ENV === 'production'
const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uemnappyzjqntildlhlr.supabase.co')
const supabaseSocket = `${supabase.protocol === 'https:' ? 'wss:' : 'ws:'}//${supabase.host}`

// Everything the browser may load or contact. scripts/check-privacy.mjs already holds the code to "no remote script, font
// or iframe", so this list stays short. Next's App Router emits inline bootstrap scripts, hence 'unsafe-inline' on
// script-src; what this policy adds is that an injected script could neither load more code nor send a stolen session
// anywhere except this site and Supabase. Dev adds 'unsafe-eval' (webpack) and Vercel's debug analytics script.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval' https://va.vercel-scripts.com"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase.origin}`,
  "font-src 'self' data: blob:",
  `connect-src 'self' blob: data: ${supabase.origin} ${supabaseSocket}`,
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ['upgrade-insecure-requests'] : []),
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // a11y-widget ships TypeScript/TSX source, not a pre-built bundle (see its
  // own README) — this is what makes Next transpile it like first-party code.
  transpilePackages: ['a11y-widget'],
  poweredByHeader: false,
  // Nothing here uses next/image, so the optimizer route is switched off rather than left as attack surface.
  images: { unoptimized: true },

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
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
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