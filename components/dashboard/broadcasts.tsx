"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon, MegaphoneIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  BroadcastStatusBadge,
  ConfirmDelete,
  EmptyState,
  FilterSelect,
  MoreMenu,
  MoreMenuItem,
  PageHeader,
  ResourceTable,
  SearchField,
  Surface,
  Th,
  Toolbar,
} from "@/components/dashboard/primitives"
import { formatDate, formatDateTime, percent } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { BroadcastStatus } from "@/lib/dashboard/types"

function CreateBroadcastDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addBroadcast, state } = useDashboard()
  const [name, setName] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [preview, setPreview] = React.useState("")
  const [segmentId, setSegmentId] = React.useState("")
  const [topicId, setTopicId] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setName("")
    setSubject("")
    setPreview("")
    setSegmentId("")
    setTopicId("")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || !subject.trim()) {
      setError("Name and subject are required")
      return
    }
    const created = addBroadcast({
      name,
      subject,
      preview,
      segmentId: segmentId || null,
      topicId: topicId || null,
    })
    toast.add({ type: "success", title: "Broadcast created" })
    reset()
    onOpenChange(false)
    router.push(`/broadcasts/${created.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create broadcast</DialogTitle>
            <DialogDescription>
              Compose to a segment, optionally scoped to a topic so unsubscribe
              stays precise.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="brd-name">Name</FieldLabel>
              <Input
                id="brd-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="brd-subject">Subject</FieldLabel>
              <Input
                id="brd-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="brd-preview">Preview text</FieldLabel>
              <Input
                id="brd-preview"
                value={preview}
                onChange={(event) => setPreview(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="brd-segment">Segment</FieldLabel>
              <select
                id="brd-segment"
                value={segmentId}
                onChange={(event) => setSegmentId(event.target.value)}
                className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
              >
                <option value="">All contacts</option>
                {state.segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="brd-topic">Topic</FieldLabel>
              <select
                id="brd-topic"
                value={topicId}
                onChange={(event) => setTopicId(event.target.value)}
                className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
              >
                <option value="">No topic</option>
                {state.topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
              <FieldDescription>
                Contacts unsubscribed from this topic are skipped.
              </FieldDescription>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create draft</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function BroadcastsView() {
  const { state, deleteBroadcast } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)

  const rows = state.broadcasts.filter((item) => {
    if (query && !item.name.toLowerCase().includes(query.trim().toLowerCase())) {
      return false
    }
    if (status && item.status !== status) return false
    return true
  })

  return (
    <>
      <PageHeader
        title="Broadcasts"
        description="Marketing sends to a segment. Unsubscribe and topics are honored automatically."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Create broadcast
        </Button>
      </PageHeader>
      <Toolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search broadcasts…"
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="All statuses"
          options={(["draft", "scheduled", "queued", "sent", "canceled"] as BroadcastStatus[]).map(
            (value) => ({ value, label: value })
          )}
        />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState
          icon={MegaphoneIcon}
          title="No broadcasts"
          description="Create a draft, pick a segment, and send when the copy is ready."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Create broadcast
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Audience</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => {
            const segment = state.segments.find((row) => row.id === item.segmentId)
            return (
              <TableRow key={item.id}>
                <TableCell>
                  <Link
                    href={`/broadcasts/${item.id}`}
                    className="font-medium hover:underline"
                  >
                    {item.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{item.subject}</div>
                </TableCell>
                <TableCell>
                  <BroadcastStatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {segment?.name ?? "All contacts"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(item.createdAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <MoreMenuItem render={<Link href={`/broadcasts/${item.id}`} />}>
                      Open
                    </MoreMenuItem>
                    <MoreMenuItem
                      variant="destructive"
                      onClick={() => setPending(item.id)}
                    >
                      Delete
                    </MoreMenuItem>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </ResourceTable>
      )}
      <CreateBroadcastDialog open={open} onOpenChange={setOpen} />
      <ConfirmDelete
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Delete broadcast?"
        description="This draft or history row is removed from the workspace."
        onConfirm={() => {
          if (pending) deleteBroadcast(pending)
          toast.add({ type: "success", title: "Broadcast deleted" })
        }}
      />
    </>
  )
}

export function BroadcastDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, updateBroadcast, setBroadcastStatus, deleteBroadcast } =
    useDashboard()
  const item = state.broadcasts.find((row) => row.id === id)
  const [pending, setPending] = React.useState(false)

  if (!item) {
    return (
      <EmptyState
        icon={MegaphoneIcon}
        title="Broadcast not found"
        description="It may have been deleted from this workspace."
      >
        <Button nativeButton={false} render={<Link href="/broadcasts" />}>
          Back to broadcasts
        </Button>
      </EmptyState>
    )
  }

  const segment = state.segments.find((row) => row.id === item.segmentId)
  const topic = state.topics.find((row) => row.id === item.topicId)
  const stats = item.stats

  return (
    <>
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="-ml-2 text-muted-foreground"
          render={<Link href="/broadcasts" />}
        >
          <ArrowLeftIcon />
          Broadcasts
        </Button>
        <PageHeader title={item.name}>
          {item.status === "draft" ? (
            <Button
              onClick={() => {
                setBroadcastStatus(item.id, "sent")
                toast.add({ type: "success", title: "Broadcast sent" })
              }}
            >
              Send now
            </Button>
          ) : null}
          {item.status === "scheduled" ? (
            <Button
              variant="outline"
              onClick={() => {
                setBroadcastStatus(item.id, "canceled")
                toast.add({ type: "success", title: "Broadcast canceled" })
              }}
            >
              Cancel
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setPending(true)}>
            Delete
          </Button>
        </PageHeader>
        <div className="flex flex-wrap items-center gap-2 text-small text-muted-foreground">
          <BroadcastStatusBadge status={item.status} />
          <span>{segment?.name ?? "All contacts"}</span>
          {topic ? <span>Topic · {topic.name}</span> : null}
        </div>
      </div>

      <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["Recipients", stats.recipients],
            ["Delivered", stats.delivered],
            ["Opened", stats.opened],
            ["Clicked", stats.clicked],
            ["Bounced", stats.bounced],
          ] as const
        ).map(([label, value]) => (
          <Surface key={label} className="[&_.panel]:p-4">
            <p className="font-mono text-caption text-muted-foreground">{label}</p>
            <p className="text-h4">{value.toLocaleString()}</p>
            {label !== "Recipients" ? (
              <p className="text-small text-muted-foreground">
                {percent(value, stats.recipients)}
              </p>
            ) : null}
          </Surface>
        ))}
      </div>

      <Surface className="max-w-lg">
        <Field>
          <FieldLabel htmlFor="brd-edit-name">Name</FieldLabel>
          <Input
            id="brd-edit-name"
            value={item.name}
            onChange={(event) =>
              updateBroadcast(item.id, { name: event.target.value })
            }
            disabled={item.status === "sent"}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="brd-edit-subject">Subject</FieldLabel>
          <Input
            id="brd-edit-subject"
            value={item.subject}
            onChange={(event) =>
              updateBroadcast(item.id, { subject: event.target.value })
            }
            disabled={item.status === "sent"}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="brd-edit-preview">Preview text</FieldLabel>
          <Input
            id="brd-edit-preview"
            value={item.preview}
            onChange={(event) =>
              updateBroadcast(item.id, { preview: event.target.value })
            }
            disabled={item.status === "sent"}
          />
        </Field>
        {item.sentAt ? (
          <p className="text-small text-muted-foreground">
            Sent {formatDateTime(item.sentAt)}
          </p>
        ) : null}
      </Surface>

      <ConfirmDelete
        open={pending}
        onOpenChange={setPending}
        title={`Delete ${item.name}?`}
        description="This removes the broadcast from the workspace."
        onConfirm={() => {
          deleteBroadcast(item.id)
          toast.add({ type: "success", title: "Broadcast deleted" })
          router.push("/broadcasts")
        }}
      />
    </>
  )
}
