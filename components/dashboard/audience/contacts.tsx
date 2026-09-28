"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { DateRange } from "react-day-picker"
import type { Id } from "@/convex/_generated/dataModel"

import { Badge } from "@/components/ui/badge"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsButton,
  EmptyState,
  ListPagination,
  ListToolbar,
  MonoValue,
  MoreMenu,
  OptionSelect,
  ResourceTable,
  SelectionBar,
  Th,
  useDebouncedValue,
} from "@/components/dashboard/primitives"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AudienceChrome,
  AudienceDocsSheet,
  SUBSCRIBED_ITEMS,
} from "@/components/dashboard/audience/shared"
import {
  ChevronDownIcon,
  LayersIcon,
  PencilIcon,
  PlusIcon,
  TagIcon,
  Trash2Icon,
  UploadIcon,
  UsersIcon,
} from "lucide-react"
import {
  parseCsv,
  parseUnsubscribed,
  splitEmails,
  suggestCsvMapping,
} from "@/lib/dashboard/csv"
import {
  RESERVED_PROPERTY_KEYS,
  type ContactInput,
} from "@/lib/dashboard/contacts"
import { rangeBounds } from "@/lib/dashboard/email-range"
import { formatDate, pluralize } from "@/lib/dashboard/format"
import { useExportDialog } from "@/components/dashboard/export-dialog"
import {
  useAudienceCommands,
  useContactList,
  useProperties,
  useSegments,
  useTopics,
} from "@/lib/audience/use-audience"
import { actionError } from "@/lib/action-error"
import { useClock } from "@/lib/time/use-clock"

function segmentItems(segments: { id: string; name: string; count: number }[]) {
  return [
    { value: "all", label: "All segments" },
    ...segments.map((segment) => ({
      value: segment.id,
      label: `${segment.name} (${segment.count})`,
    })),
  ]
}

function segmentOptions(segments: { id: string; name: string }[]) {
  return [
    { value: "none", label: "No segment" },
    ...segments.map((segment) => ({ value: segment.id, label: segment.name })),
  ]
}

function AddManuallyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { upsertContacts } = useAudienceCommands()
  const segments = useSegments() ?? []
  const [pending, setPending] = React.useState(false)
  const [emails, setEmails] = React.useState("")
  const [segmentId, setSegmentId] = React.useState("none")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setEmails("")
    setSegmentId("none")
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const list = splitEmails(emails)
    if (list.length === 0) {
      setError("Enter at least one valid email address")
      return
    }
    setPending(true)
    try {
      const { createdIds, skipped } = await upsertContacts(
        list.map((email) => ({ email })),
        segmentId === "none" ? [] : [segmentId],
        true
      )
      toast.add({
        type: "success",
        title:
          createdIds.length === 1
            ? "Contact created"
            : `${createdIds.length} contacts created`,
        description:
          skipped > 0
            ? `${skipped} already in this workspace were skipped.`
            : undefined,
      })
      reset()
      onOpenChange(false)
      if (createdIds.length === 1) router.push(`/contacts/${createdIds[0]}`)
    } catch (caught) {
      setError(actionError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add manually</DialogTitle>
            <DialogDescription>
              Paste addresses separated by commas or new lines. Existing emails
              are skipped.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="manual-emails">Email addresses</FieldLabel>
              <Textarea
                id="manual-emails"
                value={emails}
                onChange={(event) => {
                  setEmails(event.target.value)
                  setError(null)
                }}
                placeholder="ada@example.com, grace@hopper.dev"
                rows={5}
                autoFocus
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            {segments.length > 0 ? (
              <Field>
                <FieldLabel htmlFor="manual-segment">Segment</FieldLabel>
                <OptionSelect
                  id="manual-segment"
                  className="w-full"
                  value={segmentId}
                  onChange={setSegmentId}
                  items={segmentOptions(segments)}
                />
                <FieldDescription>
                  Optional. You can assign more segments from the contact page.
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ImportCsvDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { upsertContacts } = useAudienceCommands()
  const properties = useProperties() ?? []
  const segments = useSegments() ?? []
  const [pending, setPending] = React.useState(false)
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [headers, setHeaders] = React.useState<string[]>([])
  const [rows, setRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<string[]>([])
  const [segmentId, setSegmentId] = React.useState("none")
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const mapItems = [
    { value: "ignore", label: "Ignore" },
    ...RESERVED_PROPERTY_KEYS.map((key) => ({ value: key, label: key })),
    ...properties.map((property) => ({
      value: property.key,
      label: property.key,
    })),
  ]

  function reset() {
    setFileName(null)
    setHeaders([])
    setRows([])
    setMapping([])
    setSegmentId("none")
    setError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  function applyFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const table = parseCsv(String(reader.result ?? ""))
        if (table.headers.length === 0) {
          setError("That CSV has no header row")
          return
        }
        setFileName(file.name)
        setHeaders(table.headers)
        setRows(table.rows)
        setMapping(
          table.headers.map((header) =>
            suggestCsvMapping(
              header,
              properties.map((property) => property.key)
            )
          )
        )
        setError(null)
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not parse CSV"
        )
      }
    }
    reader.readAsText(file)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const emailIndex = mapping.indexOf("email")
    if (emailIndex === -1) {
      setError("Map one column to email")
      return
    }
    const inputs = rows.flatMap((row): ContactInput[] => {
      const email = row[emailIndex]?.trim().toLowerCase() ?? ""
      if (!email) return []
      const properties: Record<string, string> = {}
      let firstName: string | undefined
      let lastName: string | undefined
      let unsubscribed: boolean | undefined
      mapping.forEach((target, index) => {
        const value = row[index] ?? ""
        if (target === "ignore" || target === "email") return
        if (target === "first_name") firstName = value
        else if (target === "last_name") lastName = value
        else if (target === "unsubscribed")
          unsubscribed = parseUnsubscribed(value)
        else if (value) properties[target] = value
      })
      return [{ email, firstName, lastName, unsubscribed, properties }]
    })
    if (inputs.length === 0) {
      setError("No rows with an email address")
      return
    }
    setPending(true)
    try {
      const result = await upsertContacts(
        inputs,
        segmentId === "none" ? [] : [segmentId],
        false,
        true
      )
      toast.add({
        type: "success",
        title: "Import finished",
        description: `${result.created} created, ${result.updated} updated.`,
      })
      reset()
      onOpenChange(false)
    } catch (caught) {
      setError(actionError(caught))
    } finally {
      setPending(false)
    }
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
            <DialogTitle>Import CSV</DialogTitle>
            <DialogDescription>
              Map columns to email, name, unsubscribed, or an existing property.
              Matching addresses are updated.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="csv-file">CSV file</FieldLabel>
              <input
                ref={inputRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) applyFile(file)
                }}
              />
              {fileName ? (
                <FieldDescription>
                  {fileName} · {pluralize(rows.length, "row")}
                </FieldDescription>
              ) : null}
            </Field>
            {headers.length > 0 ? (
              <Field>
                <FieldLabel>Column mapping</FieldLabel>
                <div className="space-y-2 rounded-lg border border-border p-3">
                  {headers.map((header, index) => (
                    <div
                      key={`${header}-${index}`}
                      className="grid grid-cols-[1fr_auto] items-center gap-3"
                    >
                      <MonoValue>{header}</MonoValue>
                      <OptionSelect
                        size="sm"
                        align="end"
                        className="w-40"
                        aria-label={`Map column ${header}`}
                        value={mapping[index] ?? "ignore"}
                        onChange={(next) =>
                          setMapping((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? next : item
                            )
                          )
                        }
                        items={mapItems}
                      />
                    </div>
                  ))}
                </div>
              </Field>
            ) : null}
            {segments.length > 0 ? (
              <Field>
                <FieldLabel htmlFor="import-segment">Add to segment</FieldLabel>
                <OptionSelect
                  id="import-segment"
                  className="w-full"
                  value={segmentId}
                  onChange={setSegmentId}
                  items={segmentOptions(segments)}
                />
              </Field>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={rows.length === 0 || pending}>
              Import
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BulkEditDialog({
  open,
  onOpenChange,
  selectedIds,
  onApplied,
  mode,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
  onApplied: () => void
  mode: "segments" | "topics"
}) {
  const { addContactsToSegments, subscribeContactsToTopics } =
    useAudienceCommands()
  const segments = useSegments() ?? []
  const topics = useTopics() ?? []
  const [pending, setPending] = React.useState(false)
  const [picked, setPicked] = React.useState<string[]>([])

  function toggle(id: string, checked: boolean) {
    setPicked((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id)
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (picked.length === 0 || pending) return
    setPending(true)
    try {
      if (mode === "segments") {
        await addContactsToSegments(selectedIds, picked)
        toast.add({ type: "success", title: "Added to segments" })
      } else {
        await subscribeContactsToTopics(selectedIds, picked)
        toast.add({ type: "success", title: "Subscribed to topics" })
      }
      setPicked([])
      onOpenChange(false)
      onApplied()
    } catch (caught) {
      toast.add({ type: "error", title: actionError(caught) })
    } finally {
      setPending(false)
    }
  }

  const options = (mode === "segments" ? segments : topics).map((item) => ({
    id: item.id,
    name: item.name,
  }))

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPicked([])
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {mode === "segments" ? "Add to segments" : "Subscribe to topics"}
            </DialogTitle>
            <DialogDescription>
              Applies to {pluralize(selectedIds.length, "selected contact")}.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            {options.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {mode === "segments"
                  ? "Create a segment first."
                  : "Create a topic first."}
              </p>
            ) : (
              <div className="space-y-2 rounded-lg border border-border p-3">
                {options.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      checked={picked.includes(item.id)}
                      onCheckedChange={(checked) =>
                        toggle(item.id, checked === true)
                      }
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            )}
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={picked.length === 0 || pending}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ContactsView() {
  const { deleteContacts } = useAudienceCommands()
  const segments = useSegments()
  const [query, setQuery] = React.useState("")
  const [subscribed, setSubscribed] = React.useState("all")
  const [segment, setSegment] = React.useState("all")
  const [range, setRange] = React.useState<DateRange | undefined>(undefined)
  const now = useClock() ?? undefined
  const [manualOpen, setManualOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [selection, setSelected] = React.useState<string[]>([])
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const [bulkDelete, setBulkDelete] = React.useState(false)
  const [bulkMode, setBulkMode] = React.useState<"segments" | "topics" | null>(
    null
  )

  const search = useDebouncedValue(query)
  const filters = {
    search,
    ...(subscribed !== "all"
      ? { unsubscribed: subscribed === "unsubscribed" }
      : {}),
    ...(segment !== "all" ? { segmentId: segment as Id<"segments"> } : {}),
    ...rangeBounds(range),
  }
  const contacts = useContactList(filters)
  const exporting = useExportDialog({
    resource: "contacts",
    noun: "contacts",
    filters: { ...filters, search: query.trim() || undefined },
  })
  const { rows, pageRows, pagination } = contacts

  const visibleIds = rows.map((contact) => contact.id)
  /* Bulk actions only ever touch rows the current filters still show. */
  const visibleSet = new Set(visibleIds)
  const selected = selection.filter((id) => visibleSet.has(id))
  const selectedSet = new Set(selected)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id))

  function toggleAll(checked: boolean) {
    setSelected(checked ? visibleIds : [])
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id)
    )
  }

  return (
    <AudienceChrome
      actions={
        <>
          <DocsButton onClick={() => setDocsOpen(true)} />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button />}>
              <PlusIcon data-icon="inline-start" />
              Add Contacts
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setManualOpen(true)}>
                  <PlusIcon />
                  Add Manually
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImportOpen(true)}>
                  <UploadIcon />
                  Import CSV
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {exporting.dialog}
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search contacts…"
        range={range}
        onRangeChange={setRange}
        now={now}
        filters={[
          {
            value: subscribed,
            onChange: setSubscribed,
            items: SUBSCRIBED_ITEMS,
            "aria-label": "Filter by subscription",
          },
          {
            value: segment,
            onChange: setSegment,
            items: segmentItems(segments ?? []),
            "aria-label": "Filter by segment",
          },
        ]}
        onExport={exporting.open}
      />
      <SelectionBar count={selected.length} onClear={() => setSelected([])}>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" />}>
            Edit
            <ChevronDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-56">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => setBulkMode("segments")}>
                <LayersIcon />
                Add to segments
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setBulkMode("topics")}>
                <TagIcon />
                Subscribe to topics
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setBulkDelete(true)}
        >
          <Trash2Icon data-icon="inline-start" />
          Delete
        </Button>
      </SelectionBar>
      {contacts.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No contacts"
          description="Add a contact or import a CSV to start building your audience."
        >
          <Button onClick={() => setManualOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add Contacts
          </Button>
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                    aria-label="Select all contacts"
                  />
                </Th>
                <Th>Email</Th>
                <Th>First name</Th>
                <Th>Last name</Th>
                <Th>Created</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedSet.has(contact.id)}
                    onCheckedChange={(checked) =>
                      toggleOne(contact.id, checked === true)
                    }
                    aria-label={`Select ${contact.email}`}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="font-medium hover:underline"
                  >
                    {contact.email}
                  </Link>
                  {contact.unsubscribed ? (
                    <Badge variant="secondary" className="ml-2">
                      Unsubscribed
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {contact.firstName || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {contact.lastName || "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(contact.createdAt)}
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        render={<Link href={`/contacts/${contact.id}`} />}
                      >
                        <PencilIcon />
                        Edit Contact
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setPendingDelete(contact.id)}
                      >
                        <Trash2Icon />
                        Delete Contact
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <ListPagination {...pagination} noun="contact" />
        </>
      )}
      <AddManuallyDialog open={manualOpen} onOpenChange={setManualOpen} />
      <ImportCsvDialog open={importOpen} onOpenChange={setImportOpen} />
      <AudienceDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
      <BulkEditDialog
        open={bulkMode !== null}
        onOpenChange={(next) => {
          if (!next) setBulkMode(null)
        }}
        selectedIds={selected}
        onApplied={() => setSelected([])}
        mode={bulkMode ?? "segments"}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete contact?"
        description="This removes the address from every segment. Suppression history is kept separately."
        onConfirm={async () => {
          if (pendingDelete) {
            await deleteContacts([pendingDelete])
            setSelected((current) =>
              current.filter((id) => id !== pendingDelete)
            )
          }
          toast.add({ type: "success", title: "Contact deleted" })
        }}
      />
      <ConfirmDialog
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        title={`Delete ${pluralize(selected.length, "contact")}?`}
        description="Selected addresses are removed from every segment."
        onConfirm={async () => {
          await deleteContacts(selected)
          setSelected([])
          toast.add({ type: "success", title: "Contacts deleted" })
        }}
      />
    </AudienceChrome>
  )
}
