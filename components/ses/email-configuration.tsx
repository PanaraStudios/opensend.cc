"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useQuery } from "convex/react"
import { MailIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { EmptyState } from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/** Reused by email-only screens and email filters in multichannel screens. */
export function EmailConfiguration({
  children,
  required = true,
}: {
  children?: ReactNode
  required?: boolean
}) {
  const status = useQuery(api.installation.status, required ? {} : "skip")
  if (!required) return children
  if (!status) return <Skeleton className="h-40 w-full" />
  if (status.emailConfigured) return children
  return (
    <EmptyState
      icon={MailIcon}
      title="Connect Amazon SES to send email"
      description={
        status.admin
          ? "Set up email in instance settings, or connect a messaging channel."
          : "Ask your instance admin to connect Amazon SES, or connect a messaging channel."
      }
    >
      {status.admin && (
        <Button nativeButton={false} render={<Link href="/instance/ses" />}>
          Connect Amazon SES
        </Button>
      )}
      <Button
        variant="outline"
        nativeButton={false}
        render={<Link href="/channels" />}
      >
        Connect a channel
      </Button>
    </EmptyState>
  )
}
