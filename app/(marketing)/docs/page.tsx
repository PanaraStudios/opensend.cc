import type { Metadata } from "next"

import { BookOpenIcon } from "lucide-react"
import { WipPage } from "@/components/marketing/wip-page"
import { PAGES } from "@/content/site"
import { pageMetadata } from "@/lib/seo"

export const metadata: Metadata = pageMetadata(PAGES.docs)

export default function DocsPage() {
  return (
    <WipPage
      label="Docs"
      icon={BookOpenIcon}
      description="The self-hosting guide will cover Docker Compose, AWS SES, the Resend-compatible API, self-hosted Convex, and Better Auth. Until then, read the repo."
    />
  )
}
