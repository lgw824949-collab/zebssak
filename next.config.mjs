/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiKey = process.env.SEOUL_METRO_API_KEY?.trim()
    if (!apiKey) {
      return []
    }

    // Vercel → swopenAPI HTTP 프록시 (서버리스 직접 fetch 타임아웃 완화)
    return [
      {
        source: '/api/_seoul-metro/:path*',
        destination: `http://swopenAPI.seoul.go.kr/api/subway/${encodeURIComponent(apiKey)}/:path*`,
      },
    ]
  },
}

export default nextConfig
