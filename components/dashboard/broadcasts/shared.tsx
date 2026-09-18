"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  DocsSheet,
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
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed text-muted-foreground">
        {`POST /broadcasts
{
  "name": "Launch week",
  "segmentId": "seg_newsletter",
  "subject": "Launch week is live",
  "html": "<p>What shipped.</p>"
}`}
      </pre>
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

export function RenameBroadcastDialog({
  open,
  onOpenChange,
  name,
  onRename,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onRename: (name: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <RenameBroadcastForm
          name={name}
          onRename={onRename}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  )
}

function RenameBroadcastForm({
  name,
  onRename,
  onOpenChange,
}: {
  name: string
  onRename: (name: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const [value, setValue] = React.useState(name)
  const [error, setError] = React.useState<string | null>(null)

  return (
    <DialogContent className="sm:max-w-md">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!value.trim()) {
            setError("Enter a name")
            return
          }
          onRename(value.trim())
          onOpenChange(false)
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename broadcast</DialogTitle>
          <DialogDescription>
            This name is only used in the dashboard.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="brd-rename">Name</FieldLabel>
            <Input
              id="brd-rename"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setError(null)
              }}
              autoFocus
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit">Save</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
