import type { Metadata } from "next"
import { QuoteIcon } from "lucide-react"
import Link from "next/link"

import { Logo } from "@/components/logo"
import { RandomQuote } from "@/components/random-quote"

/* Account pages carry no content worth ranking; keep them out of search
   results so the landing page is what people find. */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

export default function AuthLayout({ children }: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link href="/">
            <Logo variant="full" className="text-lg" />
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">
            {children}
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary lg:block">
        {/* layered backdrop: gradient, glow, grid */}
        <div className="absolute inset-0 bg-(image:--gradient-primary)" />
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-white/15 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black,transparent)]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/25 to-transparent" />
        <QuoteIcon
          className="absolute top-10 left-10 size-16 text-white/20"
          fill="currentColor"
          strokeWidth={0}
        />

        <div className="relative flex h-full flex-col justify-end p-10 text-white">
          <RandomQuote />
        </div>
      </div>
    </div>
  )
}
