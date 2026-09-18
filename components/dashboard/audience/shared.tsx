"use client"

import { DocsSheet, SectionChrome } from "@/components/dashboard/primitives"
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

const AUDIENCE_DOCS = [
  {
    title: "Contacts",
    body: "Global addresses for broadcasts. Add them manually, import a CSV, then assign segments and topics.",
  },
  {
    title: "Properties",
    body: "Custom fields plus the reserved email, first_name, last_name, and unsubscribed keys. Use fallbacks when a contact has no value.",
  },
  {
    title: "Segments",
    body: "Internal groups for targeting. Contacts never see segment names.",
  },
  {
    title: "Topics",
    body: "Preference categories on the unsubscribe page. Scope a broadcast so contacts can leave one list without leaving all of them.",
  },
]

export function AudienceDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Audience"
      description="Contacts, properties, segments, and topics share this section."
      sections={AUDIENCE_DOCS}
    />
  )
}

export function propertyDisplayName(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
