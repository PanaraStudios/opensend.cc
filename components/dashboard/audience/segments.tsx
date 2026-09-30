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
  ListPagination,
  ListToolbar,
  MoreMenu,
  NotFoundState,
  ResourceTable,
  Surface,
  Th,
  useDeleteRecord,
  useAutosaveDraft,
  useListSearch,
} from "@/components/dashboard/primitives"
import { AudienceChrome } from "@/components/dashboard/audience/shared"
import { EyeIcon, LayersIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDate, pluralize } from "@/lib/dashboard/format"
import { useExportDialog } from "@/components/dashboard/export-dialog"
import {
  asSegment,
  useAudienceCommands,
  useContactList,
  useSegmentList,
} from "@/lib/audience/use-audience"
import { actionError } from "@/lib/action-error"

function AddSegmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addSegment } = useAudienceCommands()
  const [pending, setPending] = React.useState(false)
  const [name, setName] = React.useState("")

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || pending) return
    setPending(true)
    try {
      const id = await addSegment(trimmed)
      toast.add({ type: "success", title: "Segment created" })
      setName("")
      onOpenChange(false)
      router.push(`/segments/${id}`)
    } catch (caught) {
      toast.add({ type: "error", title: actionError(caught) })
    } finally {
      setPending(false)
    }
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
            <Button type="submit" disabled={!name.trim() || pending}>
              Create segment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SegmentsView() {
  const { deleteSegment } = useAudienceCommands()
  const { query, setQuery, search } = useListSearch()
  const [open, setOpen] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const exporting = useExportDialog({
    resource: "segments",
    noun: "segments",
    filters: { search: query.trim() || undefined },
  })
  const segments = useSegmentList(search)
  const { rows, pageRows, pagination } = segments

  return (
    <AudienceChrome
      actions={
        <>
          <DocsButton />
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Create segment
          </Button>
        </>
      }
    >
      {exporting.dialog}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search segments…"
        onExport={exporting.open}
      />
      {segments.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
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
        <>
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
            {pageRows.map((segment) => (
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
                  {segment.count}
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
          <ListPagination {...pagination} noun="segment" />
        </>
      )}
      <AddSegmentDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete segment?"
        description="Contacts stay in the workspace. They are only removed from this group."
        onConfirm={async () => {
          if (pendingDelete) await deleteSegment(pendingDelete)
          toast.add({ type: "success", title: "Segment deleted" })
        }}
      />
    </AudienceChrome>
  )
}

export function SegmentDetail() {
  const { id } = useParams<{ id: string }>()
  const stored = useQuery(api.segments.get, { id })
  const { leaving, deleteAndLeave } = useDeleteRecord("/segments")

  if (stored === undefined) return <Skeleton className="h-64 w-full" />
  if (!stored) {
    if (leaving) return null
    return (
      <NotFoundState icon={LayersIcon} noun="segment" backHref="/segments" />
    )
  }
  return <SegmentPage segment={asSegment(stored)} onDelete={deleteAndLeave} />
}

function SegmentPage({
  segment,
  onDelete,
}: {
  segment: ReturnType<typeof asSegment>
  onDelete: (remove: () => void) => void
}) {
  const { updateSegment, deleteSegment, setContactSegment } =
    useAudienceCommands()
  const [pendingDelete, setPendingDelete] = React.useState(false)
  const { query, setQuery, search } = useListSearch()
  /* A cleared field waits for a name instead of saving a blank one. */
  const name = useAutosaveDraft(segment.name, async (next) => {
    if (next.trim()) await updateSegment(segment.id, next)
  })
  const title = name.draft.trim() || segment.name
  const candidates = useContactList({ search })
  const { pageRows, pagination } = candidates
  /* Membership is checked for the page on view: a contact can be in any
     number of segments, so list rows do not carry them. */
  const members = new Set<string>(
    useQuery(
      api.segments.memberIds,
      pageRows.length
        ? {
            id: segment.id as Id<"segments">,
            contactIds: pageRows.map((contact) => contact.id as Id<"contacts">),
          }
        : "skip"
    ) ?? []
  )

  return (
    <>
      <DetailHeader
        backHref="/segments"
        backLabel="Segments"
        title={title}
        icon={LayersIcon}
        description={`${pluralize(segment.count, "contact")} · Created ${formatDate(segment.createdAt)}`}
        actions={
          <Button variant="outline" onClick={() => setPendingDelete(true)}>
            Delete
          </Button>
        }
      />

      <Surface className="max-w-lg">
        <Field>
          <FieldLabel htmlFor="segment-rename">Name</FieldLabel>
          <Input id="segment-rename" {...name.props} />
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
        {candidates.status === "LoadingFirstPage" ? (
          <Skeleton className="h-40 w-full" />
        ) : candidates.rows.length === 0 ? (
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
          <>
            <ResourceTable
              headers={
                <>
                  <Th className="w-10" />
                  <Th>Email</Th>
                  <Th>Name</Th>
                </>
              }
            >
              {pageRows.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell>
                    <Checkbox
                      checked={members.has(contact.id)}
                      onCheckedChange={(checked) => {
                        setContactSegment(
                          contact.id,
                          segment.id,
                          checked === true
                        ).catch((caught) =>
                          toast.add({
                            type: "error",
                            title: actionError(caught),
                          })
                        )
                      }}
                      aria-label={`Include ${contact.email || contact.phone || "contact"}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="hover:underline"
                    >
                      {contact.email || contact.phone || "—"}
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
            <ListPagination {...pagination} embedded noun="contact" />
          </>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title={`Delete ${title}?`}
        description="Contacts remain in the workspace. They are only removed from this segment."
        onConfirm={() => {
          onDelete(() => void deleteSegment(segment.id))
          toast.add({ type: "success", title: "Segment deleted" })
        }}
      />
    </>
  )
}
