import type { MetadataRoute } from "next"

import { PAGES, SITE } from "@/content/site"

const INDEXABLE = Object.values(PAGES).filter((page) => !("index" in page && !page.index))

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE.url,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...INDEXABLE.map((page) => ({
      url: `${SITE.url}${page.path}`,
      changeFrequency: "monthly" as const,
      priority: page.path === "/waitlist" ? 0.8 : 0.3,
    })),
  ]
}
