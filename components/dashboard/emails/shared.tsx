"use client"

import {
  SectionChrome,
  emailStatusDotClassName,
  type SelectOption,
} from "@/components/dashboard/primitives"
import {
  emailStatusLabel,
  suppressionReasonLabel,
} from "@/lib/dashboard/format"
import { EMAIL_TABS } from "@/lib/dashboard/nav"
import type { EmailStatus, SuppressionReason } from "@/lib/dashboard/types"

export { defaultEmailRange } from "@/lib/dashboard/email-range"

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

export function isFilterableStatus(value: string): value is EmailStatus {
  return (FILTERABLE_STATUSES as string[]).includes(value)
}

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
