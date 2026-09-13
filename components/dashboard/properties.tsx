"use client"

import * as React from "react"
import { PlusIcon, TagIcon } from "lucide-react"

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
  ConfirmDelete,
  EmptyState,
  MoreMenu,
  MoreMenuItem,
  PageHeader,
  ResourceTable,
  SearchField,
  SectionTabs,
  Th,
} from "@/components/dashboard/primitives"
import { AUDIENCE_TABS } from "@/lib/dashboard/nav"
import { formatDate } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { PropertyType } from "@/lib/dashboard/types"

export function PropertiesView() {
  const { state, addProperty, deleteProperty } = useDashboard()
  const [query, setQuery] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState("")
  const [key, setKey] = React.useState("")
  const [type, setType] = React.useState<PropertyType>("string")
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<string | null>(null)

  const rows = state.properties.filter((item) => {
    const haystack = `${item.name} ${item.key}`.toLowerCase()
    return !query || haystack.includes(query.trim().toLowerCase())
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const nextKey = (key || name).trim().toLowerCase().replace(/\s+/g, "_")
    if (!name.trim() || !nextKey) {
      setError("Enter a name")
      return
    }
    if (state.properties.some((item) => item.key === nextKey)) {
      setError("That key already exists")
      return
    }
    addProperty({ name, key: nextKey, type })
    toast.add({ type: "success", title: "Property created" })
    setName("")
    setKey("")
    setType("string")
    setError(null)
    setOpen(false)
  }

  return (
    <>
      <PageHeader
        title="Audience"
        description="Custom fields on every contact. Use them to personalize broadcasts."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Add property
        </Button>
      </PageHeader>
      <SectionTabs items={AUDIENCE_TABS} />
      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search properties…"
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No properties"
          description="Add a field such as company or plan, then fill it on each contact."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Add property
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Key</Th>
              <Th>Type</Th>
              <Th>Created</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>
                <code className="font-mono text-[13px]">{item.key}</code>
              </TableCell>
              <TableCell className="capitalize text-muted-foreground">
                {item.type}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.createdAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <MoreMenuItem
                    variant="destructive"
                    onClick={() => setPending(item.id)}
                  >
                    Delete
                  </MoreMenuItem>
                </MoreMenu>
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
              <DialogTitle>Add property</DialogTitle>
              <DialogDescription>
                email, first_name, last_name, and unsubscribed are reserved.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="prop-name">Name</FieldLabel>
                <Input
                  id="prop-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="prop-key">Key</FieldLabel>
                <Input
                  id="prop-key"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="company"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="prop-type">Type</FieldLabel>
                <select
                  id="prop-type"
                  value={type}
                  onChange={(event) =>
                    setType(event.target.value as PropertyType)
                  }
                  className="h-control w-full rounded-lg border border-input bg-background px-2.5 text-sm dark:bg-surface"
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                </select>
                <FieldDescription>
                  Used when personalizing broadcasts and imports.
                </FieldDescription>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add property</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDelete
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Delete property?"
        description="Values are removed from every contact."
        onConfirm={() => {
          if (pending) deleteProperty(pending)
          toast.add({ type: "success", title: "Property deleted" })
        }}
      />
    </>
  )
}
