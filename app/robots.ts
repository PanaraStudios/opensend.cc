import type { MetadataRoute } from "next"

import { SITE } from "@/content/site"

/* Auth and account routes have no public content. AI search bots are left
   allowed — blocking them would also block citations. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/profile", "/login", "/signup", "/forgot-password"],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  }
}
