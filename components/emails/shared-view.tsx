"use client"

import * as React from "react"
import { ClockIcon, MailIcon } from "lucide-react"
import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import { EmptyState, MetaStrip } from "@/components/dashboard/primitives"
import { EmailPreviewFrame } from "@/components/dashboard/broadcasts/editor/preview"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { formatDateTime } from "@/lib/dashboard/format"

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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Shared email</p>
        <h1 className="font-heading text-h2 break-words">
          {email.subject || "(No subject)"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Expires {formatDateTime(email.expiresAt)}
        </p>
      </header>
      <MetaStrip
        items={[
          { label: "From", value: email.from },
          { label: "To", value: email.to.join(", ") },
          ...(email.cc.length
            ? [{ label: "Cc", value: email.cc.join(", ") }]
            : []),
          ...(email.replyTo.length
            ? [{ label: "Reply to", value: email.replyTo.join(", ") }]
            : []),
          { label: "Date", value: formatDateTime(email.date) },
        ]}
      />
      <div className="frame">
        <div className="panel p-4">
          {email.html ? (
            <EmailPreviewFrame
              html={email.html}
              title={email.subject || "Email preview"}
              className="h-96"
            />
          ) : (
            <pre className="text-sm break-words whitespace-pre-wrap">
              {email.text}
            </pre>
          )}
        </div>
      </div>
      {email.attachments.length ? (
        <section aria-label="Attachments" className="flex flex-col gap-3">
          <h2 className="font-heading text-h4">Attachments</h2>
          <ItemGroup>
            {email.attachments.map((file, index) => (
              <Item key={index} variant="outline" size="sm">
                <ItemContent>
                  <ItemTitle>{file.filename}</ItemTitle>
                  <ItemDescription>
                    {file.contentType} · {file.size.toLocaleString()} bytes
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </section>
      ) : null}
    </div>
  )
}
