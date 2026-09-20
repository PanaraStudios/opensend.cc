"use client"

import { useEffect } from "react"

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
          <h1>Something went wrong.</h1>
          <p>We could not load Opensend. Try again.</p>
          <button
            type="button"
            onClick={reset}
            className="rounded-md border px-4 py-2"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
