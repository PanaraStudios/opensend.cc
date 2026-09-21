import { QuoteIcon } from "lucide-react"
import Link from "next/link"
import { Logo } from "@/components/logo"
import { cn } from "@/lib/utils"
import { RandomQuote } from "@/components/random-quote"

export function AuthPageFrame({
  children,
  wide = false,
}: Readonly<{
  children: React.ReactNode
  wide?: boolean
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
          <div className={cn("w-full", wide ? "max-w-md" : "max-w-xs")}>
            {children}
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-(--auth-panel) text-(--auth-panel-foreground) lg:block">
        {/* layered backdrop: gradient, glow, grid */}
        <div className="absolute inset-0 bg-(image:--gradient-auth-panel)" />
        <div className="absolute -top-32 -right-32 size-96 rounded-full bg-white/15 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.05)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,black,transparent)] bg-[size:3.5rem_3.5rem]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/25 to-transparent" />
        <QuoteIcon
          className="absolute top-10 left-10 size-16 text-white/20"
          fill="currentColor"
          strokeWidth={0}
        />

        <div className="relative flex h-full flex-col justify-end p-10">
          <RandomQuote />
        </div>
      </div>
    </div>
  )
}
