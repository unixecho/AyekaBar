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
}

export default nextConfig