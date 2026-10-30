import localFont from "next/font/local"

import { cn } from "@/lib/utils"

// Fonts are self-hosted (latin subset woff2 under app/fonts, SIL OFL 1.1) so
// builds never reach out to Google Fonts. See app/fonts/LICENSE.md.

// Body and heading face. Variable weight; the opsz axis tightens display
// sizes and opens up small text on its own (font-optical-sizing: auto).
const fontSans = localFont({
  src: "../app/fonts/BricolageGrotesque-latin-variable.woff2",
  weight: "200 800",
  style: "normal",
  display: "swap",
  adjustFontFallback: "Arial",
  variable: "--font-geist-sans",
})

const fontMono = localFont({
  src: "../app/fonts/GeistMono-latin-variable.woff2",
  weight: "400 500",
  style: "normal",
  display: "swap",
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
  variable: "--font-geist-mono",
})

// Only the italic face is used: the one accent phrase per heading.
const fontSerif = localFont({
  src: "../app/fonts/InstrumentSerif-latin-italic.woff2",
  weight: "400",
  style: "italic",
  display: "swap",
  adjustFontFallback: "Times New Roman",
  variable: "--font-instrument-serif",
})

export const fontClassName = cn(
  "scroll-smooth font-sans antialiased",
  fontSans.variable,
  fontMono.variable,
  fontSerif.variable
)
