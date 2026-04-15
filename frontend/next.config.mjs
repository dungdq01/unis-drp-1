/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    // API_URL chỉ cần set khi BE ở domain khác (production)
    // Default: proxy đến localhost:3002 (dev + ngrok)
    const backendUrl = process.env.API_URL || 'http://localhost:3002';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
    ];
  },
};
export default nextConfig;
