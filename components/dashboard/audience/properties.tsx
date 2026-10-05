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
  ListPagination,
  ListToolbar,
  MoreMenu,
  OptionSelect,
  ResourceTable,
  Th,
  useTeamList,
  useListSearch,
} from "@/components/dashboard/primitives"
import {
  AudienceChrome,
  propertyDisplayName,
} from "@/components/dashboard/audience/shared"
import { DatabaseIcon, PlusIcon, Trash2Icon } from "lucide-react"
import {
  normalizePropertyKey,
  propertyKeyError,
  DEFAULT_CONTACT_PROPERTIES,
} from "@/lib/dashboard/contacts"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
import { formatDate } from "@/lib/dashboard/format"
import {
  asProperty,
  useAudienceCommands,
  useProperties,
} from "@/lib/audience/use-audience"
import { actionError } from "@/lib/action-error"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/convex/_generated/api"
import { fieldTypeLabel } from "@/lib/dashboard/format"
import type { ContactProperty, PropertyType } from "@/lib/dashboard/types"

type PropertyRow = ContactProperty | (typeof DEFAULT_CONTACT_PROPERTIES)[number]
const asPropertyRow = (row: Parameters<typeof asProperty>[0]): PropertyRow =>
  asProperty(row)

const PROPERTY_TYPES = (["string", "number"] as const).map((value) => ({
  value,
  label: fieldTypeLabel(value),
}))

function AddPropertyDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { addProperty } = useAudienceCommands()
  const properties = useProperties()
  const [pending, setPending] = React.useState(false)
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

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const nextKey = normalizePropertyKey(key)
    const keyError = propertyKeyError(
      nextKey,
      (properties ?? []).map((item) => item.key)
    )
    if (keyError) {
      setError(keyError)
      return
    }
    setPending(true)
    try {
      await addProperty({
        name: propertyDisplayName(nextKey),
        key: nextKey,
        type,
        fallbackValue,
      })
      toast.add({ type: "success", title: "Property created" })
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
            <Button type="submit" disabled={pending}>
              Add property
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PropertiesView() {
  const { deleteProperty } = useAudienceCommands()
  const { query, setQuery, search } = useListSearch()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)

  /* The built-in fields lead the first page, then the team's own. */
  const defaults = React.useMemo(() => {
    const needle = searchNeedle(search)
    return DEFAULT_CONTACT_PROPERTIES.filter((item) =>
      matchesNeedle(needle, item.name, item.key)
    )
  }, [search])
  const properties = useTeamList(
    api.contactProperties.list,
    api.contactProperties.count,
    { search },
    asPropertyRow,
    defaults
  )
  const { rows, pageRows, pagination } = properties

  return (
    <AudienceChrome
      actions={
        <>
          <DocsButton />
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
      {properties.status === "LoadingFirstPage" ? (
        <Skeleton className="h-40 w-full" />
      ) : rows.length === 0 ? (
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
        <>
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
            {pageRows.map((item) =>
              !("id" in item) ? (
                <TableRow key={item.key}>
                  <TableCell>
                    <code className="font-mono text-[13px]">{item.key}</code>
                    <Badge variant="secondary" className="ml-2">
                      Default
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fieldTypeLabel(item.type)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell />
                </TableRow>
              ) : (
                <TableRow key={item.id}>
                  <TableCell>
                    <code className="font-mono text-[13px]">{item.key}</code>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {fieldTypeLabel(item.type)}
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
              )
            )}
          </ResourceTable>
          <ListPagination {...pagination} noun="property" plural="properties" />
        </>
      )}
      <AddPropertyDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Delete property?"
        description="Values are removed from every contact. The fallback is discarded."
        onConfirm={async () => {
          if (pending) await deleteProperty(pending)
          toast.add({ type: "success", title: "Property deleted" })
        }}
      />
    </AudienceChrome>
  )
}
