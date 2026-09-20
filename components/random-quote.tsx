"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const QUOTES = [
  {
    text: "The purpose of a business is to create a customer.",
    author: "Peter Drucker",
  },
  {
    text: "There is only one boss. The customer.",
    author: "Sam Walton",
  },
  {
    text: "Make a customer, not a sale.",
    author: "Katherine Barchetti",
  },
  {
    text: "We're not competitor obsessed. We're customer obsessed.",
    author: "Jeff Bezos",
  },
  {
    text: "The fortune is in the follow-up.",
    author: "Jim Rohn",
  },
  {
    text: "People don't buy what you do. They buy why you do it.",
    author: "Simon Sinek",
  },
  {
    text: "Your most unhappy customers are your greatest source of learning.",
    author: "Bill Gates",
  },
  {
    text: "People don't like to be sold. They love to buy.",
    author: "Jeffrey Gitomer",
  },
  {
    text: "You don't close a sale. You open a relationship.",
    author: "Patricia Fripp",
  },
  {
    text: "Price is what you pay. Value is what you get.",
    author: "Warren Buffett",
  },
  {
    text: "Customer service shouldn't be a department. It should be the entire company.",
    author: "Tony Hsieh",
  },
  {
    text: "Seek first to understand, then to be understood.",
    author: "Stephen Covey",
  },
  {
    text: "Don't find customers for your products. Find products for your customers.",
    author: "Seth Godin",
  },
  {
    text: "If it doesn't sell, it isn't creative.",
    author: "David Ogilvy",
  },
  {
    text: "Make the customer the hero of your story.",
    author: "Ann Handley",
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
