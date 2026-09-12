import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/login", destination: "/waitlist", permanent: false },
      { source: "/signup", destination: "/waitlist", permanent: false },
      { source: "/forgot-password", destination: "/waitlist", permanent: false },
    ]
  },
}

export default nextConfig
