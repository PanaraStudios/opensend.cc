import type { Metadata } from "next"

import { SITE } from "@/content/site"

type PageFields = {
  path: string
  title: string
  description: string
  index?: boolean
}

/* Shared Open Graph fields. Child `openGraph` objects replace the parent
   entirely, so type / locale / siteName have to be repeated here. The
   image itself comes from app/opengraph-image.tsx. */
const openGraphBase = {
  type: "website" as const,
  locale: "en_US",
  siteName: SITE.name,
}

const twitterBase = {
  card: "summary_large_image" as const,
  site: SITE.xHandle,
  creator: SITE.xHandle,
}

export function pageMetadata({
  path,
  title,
  description,
  index = true,
}: PageFields): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      ...openGraphBase,
      title,
      description,
      url: path,
    },
    twitter: {
      ...twitterBase,
      title,
      description,
    },
    ...(!index ? { robots: { index: false, follow: true } } : {}),
  }
}
