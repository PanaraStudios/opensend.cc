import type { Metadata, Viewport } from "next"

import "./globals.css"
import { ProgressProvider } from "@/components/progress-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { fontClassName } from "@/lib/fonts"

export const metadata: Metadata = {
  title: { default: "Opensend", template: "%s · Opensend" },
  description: "Your self-hosted email dashboard.",
  applicationName: "Opensend",
  robots: { index: false, follow: false },
}

/* Matches the light page background so the browser chrome blends in on
   mobile. Dark uses the same near-black as --bg in .dark. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={fontClassName}
    >
      <body>
        <ThemeProvider>
          <ProgressProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </ProgressProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
