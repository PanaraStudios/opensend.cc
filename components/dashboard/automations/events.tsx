"use client"

import * as React from "react"
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
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsButton,
  EmptyState,
  IconCell,
  ListToolbar,
  MonoValue,
  MoreMenu,
  OptionSelect,
  RelativeTime,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  AutomationsChrome,
  AutomationsDocsSheet,
  EventIcon,
} from "@/components/dashboard/automations/shared"
import {
  eventListeners,
  eventNameError,
  schemaError,
} from "@/lib/dashboard/automation"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"
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
  const { state, deleteAutomationEvent } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [docsOpen, setDocsOpen] = React.useState(false)
  /* The event in the form: one being edited, or "new". */
  const [editing, setEditing] = React.useState<AutomationEvent | "new" | null>(
    null
  )
  const [deleting, setDeleting] = React.useState<AutomationEvent | null>(null)

  const needle = searchNeedle(query)
  const rows = state.automationEvents.filter((item) =>
    matchesNeedle(needle, item.name, ...item.schema.map((field) => field.key))
  )

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
            <DocsButton onClick={() => setDocsOpen(true)} />
            {addButton}
          </>
        }
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search events…"
      />
      {state.automationEvents.length === 0 ? (
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
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => (
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
          deleting &&
          eventListeners(state.automations, deleting.name).length > 0
            ? "Automations still use this event. They keep its name, and its payload is no longer checked."
            : "Its payload is no longer checked when your app sends it."
        }
        onConfirm={() => {
          if (deleting) deleteAutomationEvent(deleting.id)
          toast.add({ type: "success", title: "Event deleted" })
        }}
      />
      <AutomationsDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
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
  const { state, saveAutomationEvent } = useDashboard()
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
        onSubmit={(submitted) => {
          submitted.preventDefault()
          const problem = eventNameError(
            name,
            state.automationEvents
              .filter((item) => item.id !== event?.id)
              .map((item) => item.name)
          )
          if (problem) {
            setError(problem)
            return
          }
          const schemaProblem = schemaError(schema)
          if (schemaProblem) {
            setSchemaProblem(schemaProblem)
            return
          }
          saveAutomationEvent({ id: event?.id, name, schema })
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
              disabled={
                event !== null &&
                eventListeners(state.automations, event.name).length > 0
              }
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
