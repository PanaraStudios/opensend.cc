"use client"

import Link from "next/link"

import { EmptyState } from "@/components/dashboard/primitives"
import {
  useServerError,
  type ErrorBoundaryProps,
} from "@/components/marketing/server-error-page"
import { Button } from "@/components/ui/button"
import { STATUS } from "@/content/errors"

export default function DashboardError(props: ErrorBoundaryProps) {
  const retry = useServerError(props)
  const copy = STATUS.serverError

  return (
    <EmptyState
      icon={copy.icon}
      title={`${copy.title} ${copy.titleEm}`}
      description={copy.description}
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={retry}>Try again</Button>
        <Button
          variant="secondary"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Back home
        </Button>
      </div>
    </EmptyState>
  )
}
