import {
  Bricolage_Grotesque,
  Geist_Mono,
  Instrument_Serif,
} from "next/font/google"

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

export const fontClassName = cn(
  "scroll-smooth font-sans antialiased",
  fontSans.variable,
  fontMono.variable,
  fontSerif.variable
)
