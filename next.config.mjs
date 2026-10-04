/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  output: 'standalone',
  allowedDevOrigins: ['192.168.56.1'],
}

export default nextConfig
