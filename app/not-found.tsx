import type { Metadata } from "next"

import { MarketingChrome } from "@/components/marketing/marketing-chrome"
import {
  PublicStatusPage,
  statusMetadata,
} from "@/components/marketing/http-status-page"
import { STATUS } from "@/content/errors"

export const metadata: Metadata = statusMetadata(STATUS.notFound)

export default function NotFound() {
  return (
    <MarketingChrome>
      <PublicStatusPage copy={STATUS.notFound} />
    </MarketingChrome>
  )
}
