import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    /* A sponsor uploads up to two logos of 1 MB each; the default is 1 MB
       for the whole form. */
    serverActions: { bodySizeLimit: "3mb" },
  },
  async redirects() {
    return [
      { source: "/login", destination: "/waitlist", permanent: false },
      { source: "/signup", destination: "/waitlist", permanent: false },
      {
        source: "/forgot-password",
        destination: "/waitlist",
        permanent: false,
      },
      { source: "/audience", destination: "/contacts", permanent: false },
    ]
  },
}

export default nextConfig
