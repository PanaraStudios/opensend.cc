import type { Metadata, Viewport } from "next"
import Script from "next/script"
import {
  Bricolage_Grotesque,
  Geist_Mono,
  Instrument_Serif,
} from "next/font/google"

import "./globals.css"
import { ProgressProvider } from "@/components/progress-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SITE } from "@/content/site"
import { cn } from "@/lib/utils"

// Body and heading face. Variable weight; the opsz axis tightens display
// sizes and opens up small text on its own.
const fontSans = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-geist-sans",
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
})

// Only the italic face is used: the one accent phrase per heading.
const fontSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: "italic",
  variable: "--font-instrument-serif",
})

/* The OG and X images come from app/opengraph-image.tsx; Next adds the
   og:image and twitter:image tags from that file, so none are listed here.
   Title and description are omitted from openGraph / twitter so inner
   routes inherit their own `title` and `description` as og:title. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE.title,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: SITE.keywords,
  authors: [SITE.author],
  creator: SITE.author.name,
  publisher: SITE.publisher,
  category: "technology",
  alternates: { canonical: "./" },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "./",
    siteName: SITE.name,
  },
  twitter: {
    card: "summary_large_image",
    site: SITE.xHandle,
    creator: SITE.xHandle,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
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
      className={cn(
        "scroll-smooth font-sans antialiased",
        fontSans.variable,
        fontMono.variable,
        fontSerif.variable
      )}
    >
      <head>
        <Script
          data-website-id="dfid_o6k8AKdqSx0tSKXpu3eqO"
          data-domain="opensend.cc"
          src="https://datafa.st/js/script.js"
          strategy="afterInteractive"
        />
      </head>
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
