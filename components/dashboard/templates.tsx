"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeftIcon, FileCodeIcon, PlusIcon } from "lucide-react"

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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDelete,
  EmptyState,
  FilterSelect,
  MoreMenu,
  MoreMenuItem,
  PageHeader,
  ResourceTable,
  SearchField,
  Surface,
  TemplateStatusBadge,
  Th,
  Toolbar,
} from "@/components/dashboard/primitives"
import { formatDate } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import type { TemplateStatus } from "@/lib/dashboard/types"

function CreateTemplateDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { addTemplate } = useDashboard()
  const [name, setName] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  function reset() {
    setName("")
    setSubject("")
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError("Enter a name")
      return
    }
    const created = addTemplate({ name, subject: subject || name })
    toast.add({ type: "success", title: "Template created" })
    reset()
    onOpenChange(false)
    router.push(`/templates/${created.id}`)
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
            <DialogTitle>Create template</DialogTitle>
            <DialogDescription>
              Drafts stay unpublished until you publish them for the API.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field>
              <FieldLabel htmlFor="tpl-name">Name</FieldLabel>
              <Input
                id="tpl-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tpl-subject">Subject</FieldLabel>
              <Input
                id="tpl-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TemplatesView() {
  const { state, deleteTemplate, duplicateTemplate, setTemplateStatus } =
    useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)

  const rows = state.templates.filter((item) => {
    if (query && !item.name.toLowerCase().includes(query.trim().toLowerCase())) {
      return false
    }
    if (status && item.status !== status) return false
    return true
  })

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable transactional mail. Publish a version before the API can send it."
      >
        <Button onClick={() => setOpen(true)}>
          <PlusIcon />
          Create template
        </Button>
      </PageHeader>
      <Toolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search templates…"
        />
        <FilterSelect
          value={status}
          onChange={setStatus}
          placeholder="All statuses"
          options={(["draft", "published"] as TemplateStatus[]).map((value) => ({
            value,
            label: value,
          }))}
        />
      </Toolbar>
      {rows.length === 0 ? (
        <EmptyState
          icon={FileCodeIcon}
          title="No templates"
          description="Create a template, add variables, then publish it for sends and automations."
        >
          <Button onClick={() => setOpen(true)}>
            <PlusIcon />
            Create template
          </Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Updated</Th>
              <Th className="w-10" />
            </>
          }
        >
          {rows.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Link
                  href={`/templates/${item.id}`}
                  className="font-medium hover:underline"
                >
                  {item.name}
                </Link>
                <div className="text-xs text-muted-foreground">{item.subject}</div>
              </TableCell>
              <TableCell>
                <TemplateStatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.updatedAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <MoreMenuItem render={<Link href={`/templates/${item.id}`} />}>
                    Edit
                  </MoreMenuItem>
                  <MoreMenuItem onClick={() => duplicateTemplate(item.id)}>
                    Duplicate
                  </MoreMenuItem>
                  {item.status === "draft" ? (
                    <MoreMenuItem
                      onClick={() => {
                        setTemplateStatus(item.id, "published")
                        toast.add({ type: "success", title: "Template published" })
                      }}
                    >
                      Publish
                    </MoreMenuItem>
                  ) : null}
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
      <CreateTemplateDialog open={open} onOpenChange={setOpen} />
      <ConfirmDelete
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        title="Delete template?"
        description="Existing published sends keep their rendered copy. New API calls cannot use this template."
        onConfirm={() => {
          if (pending) deleteTemplate(pending)
          toast.add({ type: "success", title: "Template deleted" })
        }}
      />
    </>
  )
}

export function TemplateDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, updateTemplate, setTemplateStatus, deleteTemplate } =
    useDashboard()
  const item = state.templates.find((row) => row.id === id)
  const [pending, setPending] = React.useState(false)

  if (!item) {
    return (
      <EmptyState
        icon={FileCodeIcon}
        title="Template not found"
        description="It may have been deleted from this workspace."
      >
        <Button nativeButton={false} render={<Link href="/templates" />}>
          Back to templates
        </Button>
      </EmptyState>
    )
  }

  return (
    <>
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="-ml-2 text-muted-foreground"
          render={<Link href="/templates" />}
        >
          <ArrowLeftIcon />
          Templates
        </Button>
        <PageHeader title={item.name}>
          {item.status === "draft" ? (
            <Button
              onClick={() => {
                setTemplateStatus(item.id, "published")
                toast.add({ type: "success", title: "Template published" })
              }}
            >
              Publish
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setTemplateStatus(item.id, "draft")}
            >
              Revert to draft
            </Button>
          )}
          <Button variant="outline" onClick={() => setPending(true)}>
            Delete
          </Button>
        </PageHeader>
        <TemplateStatusBadge status={item.status} />
      </div>

      <Surface className="max-w-2xl">
        <Field>
          <FieldLabel htmlFor="tpl-edit-name">Name</FieldLabel>
          <Input
            id="tpl-edit-name"
            value={item.name}
            onChange={(event) =>
              updateTemplate(item.id, { name: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-edit-subject">Subject</FieldLabel>
          <Input
            id="tpl-edit-subject"
            value={item.subject}
            onChange={(event) =>
              updateTemplate(item.id, { subject: event.target.value })
            }
          />
          <FieldDescription>
            Use {"{{{VARIABLE}}}"} for substitutions.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-edit-html">HTML</FieldLabel>
          <Textarea
            id="tpl-edit-html"
            value={item.html}
            rows={10}
            onChange={(event) =>
              updateTemplate(item.id, { html: event.target.value })
            }
            className="font-mono text-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-edit-vars">Variables</FieldLabel>
          <Input
            id="tpl-edit-vars"
            value={item.variables.join(", ")}
            onChange={(event) =>
              updateTemplate(item.id, {
                variables: event.target.value
                  .split(",")
                  .map((part) => part.trim())
                  .filter(Boolean),
              })
            }
          />
          <FieldDescription>Comma-separated names, like FIRST_NAME.</FieldDescription>
        </Field>
      </Surface>

      <ConfirmDelete
        open={pending}
        onOpenChange={setPending}
        title={`Delete ${item.name}?`}
        description="This template can no longer be sent."
        onConfirm={() => {
          deleteTemplate(item.id)
          toast.add({ type: "success", title: "Template deleted" })
          router.push("/templates")
        }}
      />
    </>
  )
}
