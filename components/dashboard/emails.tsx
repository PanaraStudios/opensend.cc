"use client"

import type { ComponentType } from "react"
import Link from "next/link"
import {
  MailsIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  WebhookIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { EmptyState, PageHeader } from "@/components/dashboard/primitives"
import { useDashboard } from "@/lib/dashboard/store"
import { cn } from "@/lib/utils"

function ChecklistItem({
  done,
  href,
  title,
  description,
}: {
  done: boolean
  href: string
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 hover:bg-muted/40"
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]",
          done
            ? "border-success bg-success-soft text-success"
            : "border-border text-muted-foreground"
        )}
      >
        {done ? "✓" : ""}
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </span>
    </Link>
  )
}

export function EmailsView() {
  const { state } = useDashboard()
  const hasVerified = state.domains.some((domain) => domain.status === "verified")
  const hasKey = state.apiKeys.length > 0

  return (
    <>
      <PageHeader
        title="Emails"
        description="Transactional sends appear here. The HTTP API is still being wired; this list will fill from delivery events."
      />
      <div className="grid gap-3 md:grid-cols-3">
        <ChecklistItem
          done={hasVerified}
          href="/domains"
          title="Verify a domain"
          description="Add DNS so you can send from addresses you own."
        />
        <ChecklistItem
          done={hasKey}
          href="/api-keys"
          title="Create an API key"
          description="Use sending access for apps. Full access can manage resources."
        />
        <ChecklistItem
          done={false}
          href="/docs"
          title="Send your first email"
          description="Point the Resend SDK at your Opensend base URL."
        />
      </div>
      <EmptyState
        icon={MailsIcon}
        title="No emails yet"
        description="Once the Resend-compatible API is live, sent and received messages will list here with delivery status."
      />
    </>
  )
}

export function ComingSoonView({
  title,
  description,
  icon: Icon,
}: {
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Icon}
        title={`${title} is next`}
        description="The dashboard chrome matches Resend so these surfaces can land without another IA pass."
      >
        <Button nativeButton={false} render={<Link href="/emails" />}>
          Back to emails
        </Button>
      </EmptyState>
    </>
  )
}

export function BroadcastsView() {
  return (
    <ComingSoonView
      title="Broadcasts"
      description="Compose and send to a segment, optionally scoped to a topic so unsubscribe stays precise."
      icon={MegaphoneIcon}
    />
  )
}

export function LogsView() {
  return (
    <ComingSoonView
      title="Logs"
      description="Request-level API and SMTP logs, filterable by status, to, and idempotency key."
      icon={ScrollTextIcon}
    />
  )
}

export function WebhooksView() {
  return (
    <ComingSoonView
      title="Webhooks"
      description="Signed outgoing events mapped from SES bounces, complaints, deliveries, and opens."
      icon={WebhookIcon}
    />
  )
}
