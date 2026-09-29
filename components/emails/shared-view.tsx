"use client"

import * as React from "react"
import { ClockIcon, MailIcon } from "lucide-react"
import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import { EmptyState } from "@/components/dashboard/primitives"
import { EmailPreviewFrame } from "@/components/dashboard/broadcasts/editor/preview"

export function SharedEmailView({
  email,
  unavailable = false,
}: {
  email: FunctionReturnType<typeof api.emailShares.view>
  unavailable?: boolean
}) {
  const [expired, setExpired] = React.useState(false)
  React.useEffect(() => {
    if (!email) return
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, email.expiresAt - Date.now())
    )
    return () => window.clearTimeout(timer)
  }, [email])

  if (unavailable)
    return (
      <EmptyState
        icon={MailIcon}
        title="Unable to load email"
        description="Please try again in a moment."
      />
    )
  if (!email || expired)
    return (
      <EmptyState
        icon={ClockIcon}
        title="This share link has expired or is invalid"
        description="Ask the sender to create a new share link."
      />
    )

  // Resend's shared view is only the email: no dashboard chrome or metadata.
  return (
    <div className="frame flex min-h-0 flex-1">
      <div className="panel flex min-h-0 flex-1 p-2">
        {email.html ? (
          <EmailPreviewFrame
            html={email.html}
            title={email.subject || "Shared email"}
            className="h-auto min-h-[calc(100svh-6rem)] w-full flex-1"
          />
        ) : (
          <pre className="w-full p-4 text-sm break-words whitespace-pre-wrap">
            {email.text}
          </pre>
        )}
      </div>
    </div>
  )
}
