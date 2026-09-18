"use client"

import "./globals.css"
import { MarketingChrome } from "@/components/marketing/marketing-chrome"
import { ServerErrorPage } from "@/components/marketing/server-error-page"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { fontClassName } from "@/lib/fonts"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" suppressHydrationWarning className={fontClassName}>
      <body>
        <ThemeProvider>
          <TooltipProvider>
            <MarketingChrome>
              <ServerErrorPage error={error} reset={reset} />
            </MarketingChrome>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
