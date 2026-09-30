"use client"

import * as React from "react"
import { usePaginatedQuery, useQuery } from "convex/react"
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

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
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsButton,
  EmptyState,
  IconCell,
  ListPagination,
  ListToolbar,
  MonoValue,
  MoreMenu,
  OptionSelect,
  PAGE_SIZES,
  RelativeTime,
  ResourceTable,
  Th,
  useLoadedPagination,
  useListSearch,
} from "@/components/dashboard/primitives"
import {
  AutomationsChrome,
  EventIcon,
} from "@/components/dashboard/automations/shared"
import { eventNameError, schemaError } from "@/lib/dashboard/automation"
import { api } from "@/convex/_generated/api"
import { actionError } from "@/lib/action-error"
import {
  asAutomationEvent,
  useAutomationEventCommands,
} from "@/lib/automation-events/use-automation-events"
import {
  AUTOMATION_EVENT_FIELD_TYPES,
  type AutomationEvent,
  type AutomationEventFieldType,
} from "@/lib/dashboard/types"

const FIELD_TYPE_ITEMS = AUTOMATION_EVENT_FIELD_TYPES.map((value) => ({
  value,
  label: value,
}))

export function AutomationEventsView() {
  const { organizationId, deleteAutomationEvent } = useAutomationEventCommands()
  const { query, setQuery, search } = useListSearch()
  /* The event in the form: one being edited, or "new". */
  const [editing, setEditing] = React.useState<AutomationEvent | "new" | null>(
    null
  )
  const [deleting, setDeleting] = React.useState<AutomationEvent | null>(null)

  const deletingUsed = useQuery(
    api.automations.usesEvent,
    organizationId && deleting
      ? { organizationId, name: deleting.name }
      : "skip"
  )
  const events = usePaginatedQuery(
    api.automationEvents.list,
    organizationId ? { organizationId, search } : "skip",
    { initialNumItems: PAGE_SIZES[0] }
  )
  const rows = React.useMemo(
    () => events.results.map(asAutomationEvent),
    [events.results]
  )
  const { pageRows, pagination } = useLoadedPagination(rows, events)

  const addButton = (
    <Button onClick={() => setEditing("new")}>
      <PlusIcon data-icon="inline-start" />
      Add event
    </Button>
  )

  return (
    <>
      <AutomationsChrome
        actions={
          <>
            <DocsButton />
            {addButton}
          </>
        }
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search events…"
      />
      {events.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 && !query ? (
        <EmptyState
          icon={EventIcon}
          title="No events yet"
          description="Create events to trigger automations."
        >
          {addButton}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={EventIcon}
          title="No events found"
          description="Nothing matches this search."
        />
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Created</Th>
                <Th className="w-10" />
              </>
            }
          >
            {pageRows.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <IconCell icon={EventIcon}>
                    <MonoValue copyValue={item.name}>{item.name}</MonoValue>
                  </IconCell>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <RelativeTime at={item.createdAt} />
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => setEditing(item)}>
                        <PencilIcon />
                        Edit event
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleting(item)}
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
          <ListPagination {...pagination} noun="event" />
        </>
      )}
      <EventFormDialog
        event={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Delete event?"
        description={
          deleting && deletingUsed
            ? "Automations still use this event. They keep its name, and its payload is no longer checked."
            : "Its payload is no longer checked when your app sends it."
        }
        onConfirm={async () => {
          if (deleting) await deleteAutomationEvent(deleting.id)
          toast.add({ type: "success", title: "Event deleted" })
        }}
      />
    </>
  )
}

/** Adds an event, or edits the one passed in. */
export function EventFormDialog({
  event,
  open,
  onOpenChange,
}: {
  event: AutomationEvent | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted per opening, so the form starts from the saved event. */}
      {open ? (
        <EventForm event={event} onClose={() => onOpenChange(false)} />
      ) : null}
    </Dialog>
  )
}

function EventForm({
  event,
  onClose,
}: {
  event: AutomationEvent | null
  onClose: () => void
}) {
  const { organizationId, saveAutomationEvent } = useAutomationEventCommands()
  const eventUsed = useQuery(
    api.automations.usesEvent,
    organizationId && event ? { organizationId, name: event.name } : "skip"
  )
  const saving = React.useRef(false)
  const [name, setName] = React.useState(event?.name ?? "")
  const [schema, setSchema] = React.useState(event?.schema ?? [])
  const [error, setError] = React.useState<string | null>(null)
  const [schemaProblem, setSchemaProblem] = React.useState<string | null>(null)

  const setField = (
    index: number,
    patch: Partial<AutomationEvent["schema"][number]>
  ) => {
    setSchemaProblem(null)
    setSchema((fields) =>
      fields.map((field, at) => (at === index ? { ...field, ...patch } : field))
    )
  }

  return (
    <DialogContent className="sm:max-w-md">
      <form
        onSubmit={async (submitted) => {
          submitted.preventDefault()
          if (saving.current) return
          /* The server also refuses a name another event has. */
          const problem = eventNameError(name)
          if (problem) {
            setError(problem)
            return
          }
          const schemaProblem = schemaError(schema)
          if (schemaProblem) {
            setSchemaProblem(schemaProblem)
            return
          }
          saving.current = true
          try {
            await saveAutomationEvent({ id: event?.id, name, schema })
          } catch (failure) {
            setError(actionError(failure))
            return
          } finally {
            saving.current = false
          }
          toast.add({
            type: "success",
            title: event ? "Event updated" : "Event added",
          })
          onClose()
        }}
      >
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "Create event"}</DialogTitle>
          <DialogDescription>
            An event your app sends to start or continue an automation.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="evt-name">Event name</FieldLabel>
            <Input
              id="evt-name"
              value={name}
              className="font-mono"
              placeholder="e.g. user.created"
              /* Automations find the event by its name. */
              disabled={event !== null && eventUsed !== false}
              onChange={(changed) => {
                setName(changed.target.value)
                setError(null)
              }}
              autoFocus={!event}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>Event properties</FieldLabel>
            <FieldDescription>
              Optional. A payload that does not match is rejected with a 422.
            </FieldDescription>
            {schema.map((field, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={field.key}
                  className="min-w-0 flex-1 font-mono"
                  placeholder="Property name"
                  aria-label={`Field ${index + 1} name`}
                  onChange={(changed) =>
                    setField(index, { key: changed.target.value })
                  }
                />
                <OptionSelect
                  className="w-28"
                  value={field.type}
                  items={FIELD_TYPE_ITEMS}
                  aria-label={`Field ${index + 1} type`}
                  onChange={(type) =>
                    setField(index, { type: type as AutomationEventFieldType })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove field ${index + 1}`}
                  onClick={() =>
                    setSchema((fields) => fields.toSpliced(index, 1))
                  }
                >
                  <XIcon />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() =>
                setSchema((fields) => [...fields, { key: "", type: "string" }])
              }
            >
              <PlusIcon data-icon="inline-start" />
              Add event property
            </Button>
            {schemaProblem ? <FieldError>{schemaProblem}</FieldError> : null}
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
