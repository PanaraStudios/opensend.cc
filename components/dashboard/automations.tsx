"use client"

import * as React from "react"
import { PlusIcon, WorkflowIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TableCell, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  AutomationStatusBadge,
  ConfirmDialog,
  EmptyState,
  ListToolbar,
  MoreMenu,
  OptionSelect,
  PageHeader,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { automationStatusLabel, formatDate } from "@/lib/dashboard/format"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { useDashboard } from "@/lib/dashboard/store"
import type { AutomationStatus } from "@/lib/dashboard/types"

const AUTOMATION_STATUS_ITEMS = [
  { value: "all", label: "All statuses" },
  ...(["enabled", "disabled"] as AutomationStatus[]).map((value) => ({
    value,
    label: automationStatusLabel(value),
  })),
]

const TRIGGER_ITEMS = [
  "contact.created",
  "contact.updated",
  "contact.unsubscribed",
  "email.delivered",
  "custom.event",
].map((value) => ({ value, label: value }))

export function AutomationsView() {
  const { state, addAutomation, setAutomationStatus, deleteAutomation } =
    useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [trigger, setTrigger] = React.useState("contact.created")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)

  const needle = searchNeedle(query)
  const rows = state.automations.filter(
    (item) =>
      matchesNeedle(needle, item.name) &&
      (status === "all" || item.status === status)
  )

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError("Enter a name")
      return
    }
    addAutomation({ name, trigger })
    toast.add({ type: "success", title: "Automation created" })
    setName("")
    setTrigger("contact.created")
    setError(null)
    setOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Automations"
        description="Trigger templated emails from events. Filter by enabled or disabled, then inspect runs."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Create automation
        </Button>
      </PageHeader>
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search automations…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: AUTOMATION_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No automations"
          description="Create a workflow, pick a trigger, then enable it when the steps are ready."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Create automation
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Trigger</Th>
              <Th>Status</Th>
              <Th>Runs</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>
                <code className="font-mono text-[13px]">{item.trigger}</code>
              </TableCell>
              <TableCell>
                <AutomationStatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {item.runs}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.createdAt)}
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  <Switch
                    checked={item.status === "enabled"}
                    onCheckedChange={(checked) =>
                      setAutomationStatus(
                        item.id,
                        checked ? "enabled" : "disabled"
                      )
                    }
                    aria-label={`Toggle ${item.name}`}
                  />
                  <MoreMenu>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPending(item.id)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </MoreMenu>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setError(null)
          setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Create automation</DialogTitle>
              <DialogDescription>
                Starts disabled. Enable it after you attach a template.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="atm-name">Name</FieldLabel>
                <Input
                  id="atm-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="atm-trigger">Trigger</FieldLabel>
                <OptionSelect
                  id="atm-trigger"
                  className="w-full"
                  value={trigger}
                  onChange={setTrigger}
                  items={TRIGGER_ITEMS}
                />
                <FieldDescription>
                  Custom events can be sent through the Events API.
                </FieldDescription>
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Delete automation?"
        description="In-flight runs stop. Historical run counts are removed."
        onConfirm={() => {
          if (pending) deleteAutomation(pending)
          toast.add({ type: "success", title: "Automation deleted" })
        }}
      />
    </>
  )
}
