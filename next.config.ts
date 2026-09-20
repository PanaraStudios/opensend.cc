import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/audience", destination: "/contacts", permanent: false }]
  },
}

export default nextConfig
