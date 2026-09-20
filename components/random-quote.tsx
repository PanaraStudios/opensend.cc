"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const QUOTES = [
  {
    text: "Send email like Resend. Keep the data on your server.",
    author: "opensend.cc",
  },
  {
    text: "One Docker Compose file. Next.js, Convex, Better Auth, AWS SES.",
    author: "opensend.cc",
  },
  {
    text: "Point your Resend SDK at your own base URL.",
    author: "opensend.cc",
  },
  {
    text: "You pay Amazon for sending. Nothing per email to us.",
    author: "opensend.cc",
  },
  {
    text: "Your domain, your SES reputation, your Convex database.",
    author: "opensend.cc",
  },
] as const

export function RandomQuote() {
  const [quote, setQuote] = useState<(typeof QUOTES)[number] | null>(null)

  // Pick on the first client frame so the quote animates in on each mount and
  // never mismatches the server-rendered HTML.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)])
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <blockquote
      aria-hidden={quote === null}
      className={cn(
        "space-y-6 transition-all duration-700",
        quote ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      )}
    >
      <p className="font-serif text-3xl leading-snug text-balance italic [text-shadow:0_1px_2px_rgb(0_0_0/0.15)]">
        &ldquo;{quote?.text}&rdquo;
      </p>
      <footer className="flex items-center gap-3 text-sm">
        <div className="h-px w-8 bg-white/40" />
        <span className="font-medium">{quote?.author}</span>
      </footer>
    </blockquote>
  )
}
