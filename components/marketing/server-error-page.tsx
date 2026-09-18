"use client"

import { startTransition, useEffect } from "react"
import { useRouter } from "next/navigation"

import {
  HttpStatusPage,
  StatusHomeButton,
} from "@/components/marketing/http-status-page"
import { Button } from "@/components/ui/button"
import { STATUS } from "@/content/errors"

export type ErrorBoundaryProps = {
  error: Error & { digest?: string }
  reset: () => void
}

/** Logs the error once and returns a retry that refreshes server data before
    resetting the boundary. Shared by every error.tsx. */
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

export function ServerErrorPage(props: ErrorBoundaryProps) {
  const retry = useServerError(props)

  return (
    <HttpStatusPage copy={STATUS.serverError}>
      <Button size="xl" onClick={retry}>
        Try again
      </Button>
      <StatusHomeButton />
    </HttpStatusPage>
  )
}
