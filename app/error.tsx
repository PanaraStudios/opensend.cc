"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  useServerError,
  type ErrorBoundaryProps,
} from "@/hooks/use-server-error"

export default function RootError(props: ErrorBoundaryProps) {
  const retry = useServerError(props)

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1>Something went wrong.</h1>
      <p className="text-muted-foreground">
        We hit an error loading this page. Try again, or return to your
        dashboard.
      </p>
      <div className="flex items-center gap-2">
        <Button onClick={retry}>Try again</Button>
        <Button
          variant="secondary"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Back to dashboard
        </Button>
      </div>
    </main>
  )
}
