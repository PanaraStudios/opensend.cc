"use client"

import {
  DocsSheet,
  SectionChrome,
  emailStatusDotClassName,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  emailStatusLabel,
  suppressionReasonLabel,
} from "@/lib/dashboard/format"
import { EMAIL_TABS } from "@/lib/dashboard/nav"
import { matchesNeedle } from "@/lib/dashboard/search"
import type { EmailStatus, SuppressionReason } from "@/lib/dashboard/types"

export {
  RANGE_PRESETS,
  defaultEmailRange,
  inDateRange,
  rangeFromPreset,
  rangeLabel,
  presetFromRange,
  type RangePreset,
} from "@/lib/dashboard/email-range"

const FILTERABLE_STATUSES: EmailStatus[] = [
  "delivered",
  "opened",
  "clicked",
  "sent",
  "scheduled",
  "bounced",
  "failed",
  "canceled",
  "suppressed",
]

export const STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses", dotClassName: "bg-muted-foreground" },
  ...FILTERABLE_STATUSES.map((value) => ({
    value,
    label: emailStatusLabel(value),
    dotClassName: emailStatusDotClassName(value),
  })),
]

const SUPPRESSION_REASONS: SuppressionReason[] = [
  "manual",
  "bounced",
  "complained",
]

function reasonItem(value: SuppressionReason): SelectOption {
  return { value, label: suppressionReasonLabel(value) }
}

export const REASON_ITEMS: readonly SelectOption[] =
  SUPPRESSION_REASONS.map(reasonItem)

export const ORIGIN_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All origins" },
  reasonItem("bounced"),
  reasonItem("complained"),
  reasonItem("manual"),
]

/** `needle` comes from searchNeedle(), computed once per render. */
export function emailMatches(
  needle: string,
  fields: { to?: string; from?: string; subject?: string }
): boolean {
  return matchesNeedle(needle, fields.to, fields.from, fields.subject)
}

export function isSuppressionReason(value: string): value is SuppressionReason {
  return (SUPPRESSION_REASONS as string[]).includes(value)
}

export function EmailsChrome({
  actions,
  children,
}: {
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <SectionChrome title="Emails" tabs={EMAIL_TABS} actions={actions}>
      {children}
    </SectionChrome>
  )
}

const EMAIL_DOCS = [
  {
    title: "Sending",
    body: "POST /emails from the API or the Send email dialog. Events land on the message as they arrive from SES.",
  },
  {
    title: "Receiving",
    body: "Enable receiving on a verified domain, then send to that inbound address. Replay missed deliveries from Webhooks.",
  },
  {
    title: "Suppressions",
    body: "Hard bounces and complaints are added automatically. Manual entries skip future sends to that address.",
  },
]

export function EmailsDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Emails"
      description="Sending, inbound mail, and the suppression list share this section."
      sections={EMAIL_DOCS}
    />
  )
}
