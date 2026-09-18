"use client"

import * as React from "react"

import { Badge } from "@/components/ui/badge"
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
  ListToolbar,
  MoreMenu,
  OptionSelect,
  ResourceTable,
  Th,
} from "@/components/dashboard/primitives"
import {
  AudienceChrome,
  AudienceDocsSheet,
  propertyDisplayName,
} from "@/components/dashboard/audience/shared"
import { DatabaseIcon, PlusIcon, Trash2Icon } from "lucide-react"
import {
  isReservedPropertyKey,
  isValidPropertyKey,
  normalizePropertyKey,
} from "@/lib/dashboard/contacts"
import { DEFAULT_CONTACT_PROPERTIES } from "@/lib/dashboard/data"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { formatDate } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { PropertyType } from "@/lib/dashboard/types"

const PROPERTY_TYPES = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
] as const

function AddPropertyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, addProperty } = useDashboard()
  const [key, setKey] = React.useState("")
  const [type, setType] = React.useState<PropertyType>("string")
  const [fallbackValue, setFallbackValue] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setKey("")
    setType("string")
    setFallbackValue("")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const nextKey = normalizePropertyKey(key)
    if (!isValidPropertyKey(nextKey)) {
      setError("Use a lowercase key with letters, numbers, and underscores")
      return
    }
    if (
      isReservedPropertyKey(nextKey) ||
      state.properties.some((item) => item.key === nextKey)
    ) {
      setError("That key already exists")
      return
    }
    addProperty({
      name: propertyDisplayName(nextKey),
      key: nextKey,
      type,
      fallbackValue,
    })
    toast.add({ type: "success", title: "Property created" })
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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add property</DialogTitle>
            <DialogDescription>
              email, first_name, last_name, and unsubscribed are reserved.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="prop-key">Key</FieldLabel>
              <Input
                id="prop-key"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value)
                  setError(null)
                }}
                placeholder="company_name"
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="prop-type">Type</FieldLabel>
              <OptionSelect
                id="prop-type"
                className="w-full"
                value={type}
                onChange={(next) => {
                  if (next === "string" || next === "number") setType(next)
                }}
                items={PROPERTY_TYPES}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="prop-fallback">Fallback value</FieldLabel>
              <Input
                id="prop-fallback"
                type={type === "number" ? "number" : "text"}
                value={fallbackValue}
                onChange={(event) => setFallbackValue(event.target.value)}
                placeholder={type === "number" ? "0" : "Acme"}
              />
              <FieldDescription>
                Used in broadcasts when a contact has no value for this key.
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Add property</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PropertiesView() {
  const { state, deleteProperty } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [docsOpen, setDocsOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)

  const needle = searchNeedle(query)
  const propertyMatches = (item: { name: string; key: string }) =>
    matchesNeedle(needle, item.name, item.key)
  const defaults = DEFAULT_CONTACT_PROPERTIES.filter(propertyMatches)
  const custom = state.properties.filter(propertyMatches)

  return (
    <AudienceChrome
      actions={
        <>
          <DocsButton onClick={() => setDocsOpen(true)} />
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add property
          </Button>
        </>
      }
    >
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search properties…"
      />
      {defaults.length === 0 && custom.length === 0 ? (
        <EmptyState
          icon={DatabaseIcon}
          title="No properties"
          description="Add a field such as company or plan, then fill it on each contact."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            Add property
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Key</Th>
              <Th>Type</Th>
              <Th>Fallback</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {defaults.map((item) => (
            <TableRow key={item.key}>
              <TableCell>
                <code className="font-mono text-[13px]">{item.key}</code>
                <Badge variant="secondary" className="ml-2">
                  Default
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground capitalize">
                {item.type}
              </TableCell>
              <TableCell className="text-muted-foreground">—</TableCell>
              <TableCell className="text-muted-foreground">—</TableCell>
              <TableCell />
            </TableRow>
          ))}
          {custom.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <code className="font-mono text-[13px]">{item.key}</code>
              </TableCell>
              <TableCell className="text-muted-foreground capitalize">
                {item.type}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {item.fallbackValue || "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPending(item.id)}
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
      <AddPropertyDialog open={open} onOpenChange={setOpen} />
      <AudienceDocsSheet open={docsOpen} onOpenChange={setDocsOpen} />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Delete property?"
        description="Values are removed from every contact. The fallback is discarded."
        onConfirm={() => {
          if (pending) deleteProperty(pending)
          toast.add({ type: "success", title: "Property deleted" })
        }}
      />
    </AudienceChrome>
  )
}
