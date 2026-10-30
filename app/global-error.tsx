"use client"

import { useEffect } from "react"

import { Button } from "@/components/ui/button"

import "./globals.css"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-h3">Something went wrong.</h1>
          <p>We could not load Opensend. Try again.</p>
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        </main>
      </body>
    </html>
  )
}
