/** @type {import(next).NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: { unoptimized: true },
  experimental: {
    // after() lets us schedule work after the response is sent, keeping the
    // Vercel lambda alive until processing completes (replaces fire-and-forget).
    after: true,
  },
};

module.exports = nextConfig;
