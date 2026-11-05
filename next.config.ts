import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "standalone",
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    "@opensend/backend",
    "@opensend/core",
    "@opensendcc/sdk",
    "@opensendcc/call-gateway",
  ],
  async redirects() {
    return [{ source: "/audience", destination: "/contacts", permanent: false }]
  },
}

export default nextConfig
