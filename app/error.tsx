"use client"

import { MarketingChrome } from "@/components/marketing/marketing-chrome"
import {
  ServerErrorPage,
  type ErrorBoundaryProps,
} from "@/components/marketing/server-error-page"

/* Catches errors thrown by a route-group layout, outside any group chrome. */
export default function RootError(props: ErrorBoundaryProps) {
  return (
    <MarketingChrome>
      <ServerErrorPage {...props} />
    </MarketingChrome>
  )
}
