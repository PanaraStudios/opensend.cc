import type { LucideIcon } from "lucide-react"

import {
  HttpStatusPage,
  StatusGitHubButton,
  StatusHomeButton,
} from "@/components/marketing/http-status-page"

/* Product pages that are linked but not built yet. Lives at the real path
   (e.g. /docs) so the URL bar stays intentional. Unknown URLs still 404. */
export function WipPage({
  label,
  description,
  icon,
}: {
  label: string
  description: string
  icon?: LucideIcon
}) {
  return (
    <HttpStatusPage
      copy={{
        code: label,
        icon,
        title: "This page is",
        titleEm: "still being built.",
        description,
      }}
    >
      <StatusHomeButton />
      <StatusGitHubButton />
    </HttpStatusPage>
  )
}
