"use client"

import { startTransition, useEffect } from "react"
import { useRouter } from "next/navigation"

export type ErrorBoundaryProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export function useServerError({ error, reset }: ErrorBoundaryProps) {
  const router = useRouter()

  useEffect(() => {
    console.error(error)
  }, [error])

  return function retry() {
    startTransition(() => {
      router.refresh()
      reset()
    })
  }
}
