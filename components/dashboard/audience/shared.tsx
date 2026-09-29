"use client"

import { SectionChrome } from "@/components/dashboard/primitives"
import { AUDIENCE_TABS } from "@/lib/dashboard/nav"

export const SUBSCRIBED_ITEMS = [
  { value: "all", label: "All contacts" },
  { value: "subscribed", label: "Subscribed" },
  { value: "unsubscribed", label: "Unsubscribed" },
] as const

export function AudienceChrome({
  actions,
  children,
}: {
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <SectionChrome title="Audience" tabs={AUDIENCE_TABS} actions={actions}>
      {children}
    </SectionChrome>
  )
}

export function propertyDisplayName(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
