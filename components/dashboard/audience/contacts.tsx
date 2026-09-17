"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { DateRange } from "react-day-picker"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDelete,
  EmptyState,
  MoreMenu,
  MoreMenuItem,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  AudienceChrome,
  AudienceDocsButton,
  AudienceDocsSheet,
  AudienceToolbar,
  SUBSCRIBED_ITEMS,
} from "@/components/dashboard/audience/shared"
import { ChevronDownIcon, PlusIcon, UploadIcon, UsersIcon } from "lucide-react"
import {
  parseCsv,
  parseUnsubscribed,
  splitEmails,
  suggestCsvMapping,
} from "@/lib/dashboard/csv"
import { segmentContactCount } from "@/lib/dashboard/data"
import { inDateRange } from "@/lib/dashboard/email-range"
import { formatDate } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"

function segmentItems(state: ReturnType<typeof useDashboard>["state"]) {
  return [
    { value: "all", label: "All segments" },
    ...state.segments.map((segment) => ({
      value: segment.id,
      label: `${segment.name} (${segmentContactCount(state.contacts, segment.id)})`,
    })),
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
  const { addContact, state } = useDashboard()
  const [emails, setEmails] = React.useState("")
  const [segmentId, setSegmentId] = React.useState("none")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setEmails("")
    setSegmentId("none")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const list = splitEmails(emails)
    if (list.length === 0) {
      setError("Enter at least one valid email address")
      return
    }
    const existing = new Set(state.contacts.map((contact) => contact.email))
    const created = list.filter((email) => !existing.has(email))
    const skipped = list.length - created.length
    const segmentIds = segmentId === "none" ? [] : [segmentId]
    let firstId: string | null = null
    for (const email of created) {
      const contact = addContact({ email, segmentIds })
      firstId ??= contact.id
    }
    toast.add({
      type: "success",
      title:
        created.length === 1
          ? "Contact created"
          : `${created.length} contacts created`,
      description:
        skipped > 0 ? `${skipped} already in this workspace were skipped.` : undefined,
    })
    reset()
    onOpenChange(false)
    if (created.length === 1 && firstId) router.push(`/contacts/${firstId}`)
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
            {state.segments.length > 0 ? (
              <Field>
                <FieldLabel htmlFor="manual-segment">Segment</FieldLabel>
                <Select
                  value={segmentId}
                  onValueChange={(next) => {
                    if (next) setSegmentId(next)
                  }}
                  items={[
                    { value: "none", label: "No segment" },
                    ...state.segments.map((segment) => ({
                      value: segment.id,
                      label: segment.name,
                    })),
                  ]}
                >
                  <SelectTrigger id="manual-segment" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No segment</SelectItem>
                      {state.segments.map((segment) => (
                        <SelectItem key={segment.id} value={segment.id}>
                          {segment.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Optional. You can assign more segments from the contact page.
                </FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add</Button>
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
  const { state, upsertContacts } = useDashboard()
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [headers, setHeaders] = React.useState<string[]>([])
  const [rows, setRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<string[]>([])
  const [segmentId, setSegmentId] = React.useState("none")
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const mapItems = React.useMemo(
    () => [
      { value: "ignore", label: "Ignore" },
      { value: "email", label: "email" },
      { value: "first_name", label: "first_name" },
      { value: "last_name", label: "last_name" },
      { value: "unsubscribed", label: "unsubscribed" },
      ...state.properties.map((property) => ({
        value: property.key,
        label: property.key,
      })),
    ],
    [state.properties]
  )

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
              state.properties.map((property) => property.key)
            )
          )
        )
        setError(null)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not parse CSV")
      }
    }
    reader.readAsText(file)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const emailIndex = mapping.indexOf("email")
    if (emailIndex === -1) {
      setError("Map one column to email")
      return
    }
    const segmentIds = segmentId === "none" ? [] : [segmentId]
    const inputs = rows.flatMap((row) => {
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
        else if (target === "unsubscribed") unsubscribed = parseUnsubscribed(value)
        else if (value) properties[target] = value
      })
      return [{ email, firstName, lastName, unsubscribed, properties, segmentIds }]
    })
    if (inputs.length === 0) {
      setError("No rows with an email address")
      return
    }
    const result = upsertContacts(inputs)
    toast.add({
      type: "success",
      title: "Import finished",
      description: `${result.created} created, ${result.updated} updated.`,
    })
    reset()
    onOpenChange(false)
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
                  {fileName} · {rows.length} row{rows.length === 1 ? "" : "s"}
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
                      <span className="truncate font-mono text-[13px]">{header}</span>
                      <Select
                        value={mapping[index] ?? "ignore"}
                        onValueChange={(next) => {
                          if (!next) return
                          setMapping((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? next : item
                            )
                          )
                        }}
                        items={mapItems}
                      >
                        <SelectTrigger size="sm" className="h-8 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="end">
                          <SelectGroup>
                            {mapItems.map((item) => (
                              <SelectItem key={item.value} value={item.value}>
                                {item.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </Field>
            ) : null}
            {state.segments.length > 0 ? (
              <Field>
                <FieldLabel htmlFor="import-segment">Add to segment</FieldLabel>
                <Select
                  value={segmentId}
                  onValueChange={(next) => {
                    if (next) setSegmentId(next)
                  }}
                  items={[
                    { value: "none", label: "No segment" },
                    ...state.segments.map((segment) => ({
                      value: segment.id,
                      label: segment.name,
                    })),
                  ]}
                >
                  <SelectTrigger id="import-segment" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">No segment</SelectItem>
                      {state.segments.map((segment) => (
                        <SelectItem key={segment.id} value={segment.id}>
                          {segment.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={rows.length === 0}>
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
  mode,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
  mode: "segments" | "topics"
}) {
  const { state, addContactsToSegments, subscribeContactsToTopics } = useDashboard()
  const [picked, setPicked] = React.useState<string[]>([])

  function toggle(id: string, checked: boolean) {
    setPicked((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id)
    )
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (picked.length === 0) return
    if (mode === "segments") {
      addContactsToSegments(selectedIds, picked)
      toast.add({ type: "success", title: "Added to segments" })
    } else {
      subscribeContactsToTopics(selectedIds, picked)
      toast.add({ type: "success", title: "Subscribed to topics" })
    }
    setPicked([])
    onOpenChange(false)
  }

  const options =
    mode === "segments"
      ? state.segments.map((item) => ({ id: item.id, name: item.name }))
      : state.topics.map((item) => ({ id: item.id, name: item.name }))

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
              Applies to {selectedIds.length} selected contact
              {selectedIds.length === 1 ? "" : "s"}.
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
                  <label key={item.id} className="flex items-center gap-2 text-sm">
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={picked.length === 0}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ContactsView() {
  const { state, deleteContact, deleteContacts, addExport } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [subscribed, setSubscribed] = React.useState("all")
  const [segment, setSegment] = React.useState("all")
  const [range, setRange] = React.useState<DateRange | undefined>(undefined)
  const [manualOpen, setManualOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [pendingDelete, setPendingDelete] = React.useState<string | null>(null)
  const [bulkDelete, setBulkDelete] = React.useState(false)
  const [bulkMode, setBulkMode] = React.useState<"segments" | "topics" | null>(
    null
  )

  const rows = state.contacts.filter((contact) => {
    const haystack =
      `${contact.email} ${contact.firstName} ${contact.lastName}`.toLowerCase()
    if (query && !haystack.includes(query.trim().toLowerCase())) return false
    if (subscribed === "subscribed" && contact.unsubscribed) return false
    if (subscribed === "unsubscribed" && !contact.unsubscribed) return false
    if (segment !== "all" && !contact.segmentIds.includes(segment)) return false
    return inDateRange(contact.createdAt, range)
  })

  const visibleIds = rows.map((contact) => contact.id)
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id))

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
          <AudienceDocsButton onClick={() => setDocsOpen(true)} />
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
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{selected.length} selected</p>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="h-8" />}>
              Edit
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setBulkMode("segments")}>
                  Add to segments
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setBulkMode("topics")}>
                  Subscribe to topics
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            className="h-8"
            onClick={() => setBulkDelete(true)}
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            className="h-8"
            onClick={() => setSelected([])}
          >
            Clear
          </Button>
        </div>
      ) : (
        <AudienceToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="Search contacts…"
          range={range}
          onRangeChange={setRange}
          select={{
            value: subscribed,
            onChange: setSubscribed,
            items: SUBSCRIBED_ITEMS,
            "aria-label": "Filter by subscription",
          }}
          extraSelect={{
            value: segment,
            onChange: setSegment,
            items: segmentItems(state),
            "aria-label": "Filter by segment",
          }}
          onExport={() => {
            addExport("Contacts", rows.length)
            toast.add({ type: "success", title: "Export started" })
          }}
        />
      )}
      {rows.length === 0 ? (
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
          {rows.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell>
                <Checkbox
                  checked={selected.includes(contact.id)}
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
                    <MoreMenuItem render={<Link href={`/contacts/${contact.id}`} />}>
                      Edit Contact
                    </MoreMenuItem>
                    <MoreMenuItem
                      variant="destructive"
                      onClick={() => setPendingDelete(contact.id)}
                    >
                      Delete Contact
                    </MoreMenuItem>
                  </DropdownMenuGroup>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
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
        mode={bulkMode ?? "segments"}
      />
      <ConfirmDelete
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
        title="Delete contact?"
        description="This removes the address from every segment. Suppression history is kept separately."
        onConfirm={() => {
          if (pendingDelete) {
            deleteContact(pendingDelete)
            setSelected((current) =>
              current.filter((id) => id !== pendingDelete)
            )
          }
          toast.add({ type: "success", title: "Contact deleted" })
        }}
      />
      <ConfirmDelete
        open={bulkDelete}
        onOpenChange={setBulkDelete}
        title={`Delete ${selected.length} contact${selected.length === 1 ? "" : "s"}?`}
        description="Selected addresses are removed from every segment."
        onConfirm={() => {
          deleteContacts(selected)
          setSelected([])
          toast.add({ type: "success", title: "Contacts deleted" })
        }}
      />
    </AudienceChrome>
  )
}
