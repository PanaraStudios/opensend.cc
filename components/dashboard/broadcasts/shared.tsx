"use client"

import {
  DocsCode,
  DocsSheet,
  TextFieldDialog,
  broadcastStatusDotClassName,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { BROADCAST_STATUS_ORDER } from "@/lib/dashboard/broadcast"
import { broadcastStatusLabel } from "@/lib/dashboard/format"
import type { Segment } from "@/lib/dashboard/types"

export const BROADCAST_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...BROADCAST_STATUS_ORDER.map((value) => ({
    value,
    label: broadcastStatusLabel(value),
    dotClassName: broadcastStatusDotClassName(value),
  })),
]

export function audienceFilterItems(
  segments: Segment[]
): readonly SelectOption[] {
  return [
    { value: "all", label: "All audiences" },
    { value: "everyone", label: "All contacts" },
    ...segments.map((segment) => ({
      value: segment.id,
      label: segment.name,
    })),
  ]
}

const BROADCAST_DOCS = [
  {
    title: "Create",
    body: "Drafts stay in this workspace until you send or schedule them.",
  },
  {
    title: "API",
    body: (
      <DocsCode>
        {`POST /broadcasts
{
  "name": "Launch week",
  "segmentId": "seg_newsletter",
  "subject": "Launch week is live",
  "html": "<p>What shipped.</p>"
}`}
      </DocsCode>
    ),
  },
]

export function BroadcastsDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Broadcasts"
      description="Send one email to a segment. Topics and unsubscribes are honored."
      sections={BROADCAST_DOCS}
    />
  )
}

export function RenameBroadcastDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onRename: (name: string) => void
}) {
  return (
    <TextFieldDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Rename broadcast"
      description="This name is only used in the dashboard."
      label="Name"
      value={props.name}
      validate={(value) => (value ? null : "Enter a name")}
      onSubmit={props.onRename}
    />
  )
}
