"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@/components/ui/empty"
import {
  useServerError,
  type ErrorBoundaryProps,
} from "@/hooks/use-server-error"

export default function RootError(props: ErrorBoundaryProps) {
  const retry = useServerError(props)

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6">
      <Empty>
        <EmptyHeader>
          <h1 className="text-h3">Something went wrong.</h1>
          <EmptyDescription>
            We hit an error loading this page. Try again, or return to your
            dashboard.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={retry}>Try again</Button>
            <Button
              variant="secondary"
              nativeButton={false}
              render={<Link href="/" />}
            >
              Back to dashboard
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </main>
  )
}
