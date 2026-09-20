"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DetailHeader,
  DocsButton,
  EmptyState,
  ListToolbar,
  MoreMenu,
  NotFoundState,
  ResourceTable,
  Surface,
  Th,
  useDeleteRecord,
} from "@/components/dashboard/primitives"
import {
  AudienceChrome,
  AudienceDocsSheet,
} from "@/components/dashboard/audience/shared"
import { EyeIcon, LayersIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { contactMatches, segmentContactCounts } from "@/lib/dashboard/contacts"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { formatDate, pluralize } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"

function AddSegmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addSegment } = useDashboard()
  const [name, setName] = React.useState("")

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const { id } = addSegment(trimmed)
    toast.add({ type: "success", title: "Segment created" })
    setName("")
    onOpenChange(false)
    router.push(`/segments/${id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("")
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create segment</DialogTitle>
            <DialogDescription>
              Segments are internal groups for targeting broadcasts. Contacts
              never see the segment name.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="segment-name">Name</FieldLabel>
              <Input
                id="segment-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Customers"
                autoFocus
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!name.trim()}>
              Create segment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SegmentsView() {
  const { state, deleteSegment, addExport } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)

  const needle = searchNeedle(query)
  const rows = state.segments.filter((segment) =>
    matchesNeedle(needle, segment.name)
  )
  const memberCounts = segmentContactCounts(state.contacts)

  return (
    <AudienceChrome
      actions={
        <>
          <DocsButton onClick={() => setDocsOpen(true)} />
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Create segment
          </Button>
        </>
      }
    >
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search segments…"
        onExport={() => {
          addExport("Segments", rows.length)
          toast.add({ type: "success", title: "Export started" })
        }}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={LayersIcon}
          title="No segments"
          description="Create a segment, then add contacts to it from the contact page or in bulk."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Create segment
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Contacts</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((segment) => (
            <TableRow key={segment.id}>
              <TableCell>
                <Link
                  href={`/segments/${segment.id}`}
                  className="font-medium hover:underline"
                >
                  {segment.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {memberCounts.get(segment.id) ?? 0}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(segment.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      render={<Link href={`/segments/${segment.id}`} />}
                    >
                      <EyeIcon />
                      View segment
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPendingDelete(segment.id)}
                    >
                      <Trash2Icon />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <AddSegmentDialog open={open} onOpenChange={setOpen} />
      <AudienceDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete segment?"
        description="Contacts stay in the workspace. They are only removed from this group."
        onConfirm={() => {
          if (pendingDelete) deleteSegment(pendingDelete)
          toast.add({ type: "success", title: "Segment deleted" })
        }}
      />
    </AudienceChrome>
  )
}

export function SegmentDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, updateSegment, deleteSegment, setContactSegments } =
    useDashboard()
  const segment = state.segments.find((item) => item.id === id)
  const { leaving, deleteAndLeave } = useDeleteRecord("/segments")
  const [pendingDelete, setPendingDelete] = React.useState(false)
  const [query, setQuery] = React.useState("")

  if (!segment) {
    if (leaving) return null
    return (
      <NotFoundState icon={LayersIcon} noun="segment" backHref="/segments" />
    )
  }

  const members = state.contacts.filter((contact) =>
    contact.segmentIds.includes(segment.id)
  )
  const needle = searchNeedle(query)
  const candidates = state.contacts.filter((contact) =>
    contactMatches(contact, needle)
  )

  return (
    <>
      <DetailHeader
        backHref="/segments"
        backLabel="Segments"
        title={segment.name}
        icon={LayersIcon}
        description={`${pluralize(members.length, "contact")} · Created ${formatDate(segment.createdAt)}`}
        actions={
          <Button variant="outline" onClick={() => setPendingDelete(true)}>
            Delete
          </Button>
        }
      />

      <Surface className="max-w-lg">
        <Field>
          <FieldLabel htmlFor="segment-rename">Name</FieldLabel>
          <Input
            id="segment-rename"
            value={segment.name}
            onChange={(event) => updateSegment(segment.id, event.target.value)}
          />
          <FieldDescription>
            Only your team sees this name. It is not shown on unsubscribe pages.
          </FieldDescription>
        </Field>
      </Surface>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Contacts</h2>
          <ListToolbar
            query={query}
            onQueryChange={setQuery}
            placeholder="Filter contacts…"
          />
        </div>
        {candidates.length === 0 ? (
          <EmptyState
            icon={LayersIcon}
            title="No matching contacts"
            description="Add contacts first, then assign them to this segment."
          >
            <Button nativeButton={false} render={<Link href="/contacts" />}>
              Go to contacts
            </Button>
          </EmptyState>
        ) : (
          <ResourceTable
            headers={
              <>
                <Th className="w-10" />
                <Th>Email</Th>
                <Th>Name</Th>
              </>
            }
          >
            {candidates.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>
                  <Checkbox
                    checked={contact.segmentIds.includes(segment.id)}
                    onCheckedChange={(checked) => {
                      const next = new Set(contact.segmentIds)
                      if (checked === true) next.add(segment.id)
                      else next.delete(segment.id)
                      setContactSegments(contact.id, [...next])
                    }}
                    aria-label={`Include ${contact.email}`}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="hover:underline"
                  >
                    {contact.email}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {[contact.firstName, contact.lastName]
                    .filter(Boolean)
                    .join(" ") || "—"}
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${segment.name}?`}
        description="Contacts remain in the workspace. They are only removed from this segment."
        onConfirm={() => {
          deleteAndLeave(() => deleteSegment(segment.id))
          toast.add({ type: "success", title: "Segment deleted" })
        }}
      />
    </>
  )
}
