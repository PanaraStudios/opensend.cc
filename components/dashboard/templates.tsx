"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { FileCodeIcon, PlusIcon } from "lucide-react"

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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DetailHeader,
  EmptyState,
  ListToolbar,
  MoreMenu,
  NotFoundState,
  PageHeader,
  ResourceTable,
  Surface,
  TemplateStatusBadge,
  Th,
  useDeleteRecord,
  useDraft,
} from "@/components/dashboard/primitives"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { formatDate, templateStatusLabel } from "@/lib/dashboard/format"
import { matchesNeedle, searchNeedle } from "@/lib/dashboard/search"
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
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const TEMPLATE_STATUS_ITEMS = [
  { value: "all", label: "All statuses" },
  ...(["draft", "published"] as TemplateStatus[]).map((value) => ({
    value,
    label: templateStatusLabel(value),
  })),
]

export function TemplatesView() {
  const { state, deleteTemplate, duplicateTemplate, setTemplateStatus } =
    useDashboard()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState<string | null>(null)

  const needle = searchNeedle(query)
  const rows = state.templates.filter(
    (item) =>
      matchesNeedle(needle, item.name) &&
      (status === "all" || item.status === status)
  )

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
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search templates…"
        filters={[
          {
            value: status,
            onChange: setStatus,
            items: TEMPLATE_STATUS_ITEMS,
            "aria-label": "Filter by status",
          },
        ]}
      />
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
                <div className="text-xs text-muted-foreground">
                  {item.subject}
                </div>
              </TableCell>
              <TableCell>
                <TemplateStatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDate(item.updatedAt)}
              </TableCell>
              <TableCell>
                <MoreMenu>
                  <DropdownMenuItem
                    render={<Link href={`/templates/${item.id}`} />}
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => duplicateTemplate(item.id)}>
                    Duplicate
                  </DropdownMenuItem>
                  {item.status === "draft" ? (
                    <DropdownMenuItem
                      onClick={() => {
                        setTemplateStatus(item.id, "published")
                        toast.add({
                          type: "success",
                          title: "Template published",
                        })
                      }}
                    >
                      Publish
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setPending(item.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </MoreMenu>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      <CreateTemplateDialog open={open} onOpenChange={setOpen} />
      <ConfirmDialog
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
  const { state, updateTemplate, setTemplateStatus, deleteTemplate } =
    useDashboard()
  const item = state.templates.find((row) => row.id === id)
  const { leaving, deleteAndLeave } = useDeleteRecord("/templates")
  const [pending, setPending] = React.useState(false)
  const name = useDraft(item?.name ?? "", (value) =>
    updateTemplate(id, { name: value })
  )
  const subject = useDraft(item?.subject ?? "", (value) =>
    updateTemplate(id, { subject: value })
  )
  const html = useDraft(item?.html ?? "", (value) =>
    updateTemplate(id, { html: value })
  )
  const variables = useDraft(item?.variables.join(", ") ?? "", (value) =>
    updateTemplate(id, {
      variables: value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    })
  )

  if (!item) {
    if (leaving) return null
    return (
      <NotFoundState
        icon={FileCodeIcon}
        noun="template"
        backHref="/templates"
      />
    )
  }

  return (
    <>
      <DetailHeader
        backHref="/templates"
        backLabel="Templates"
        title={item.name}
        badge={<TemplateStatusBadge status={item.status} />}
        actions={
          <>
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
          </>
        }
      />

      <Surface className="max-w-2xl">
        <Field>
          <FieldLabel htmlFor="tpl-edit-name">Name</FieldLabel>
          <Input id="tpl-edit-name" {...name} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-edit-subject">Subject</FieldLabel>
          <Input id="tpl-edit-subject" {...subject} />
          <FieldDescription>
            Use {"{{{VARIABLE}}}"} for substitutions.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-edit-html">HTML</FieldLabel>
          <Textarea
            id="tpl-edit-html"
            rows={10}
            {...html}
            className="font-mono text-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="tpl-edit-vars">Variables</FieldLabel>
          <Input id="tpl-edit-vars" {...variables} />
          <FieldDescription>
            Comma-separated names, like FIRST_NAME.
          </FieldDescription>
        </Field>
      </Surface>

      <ConfirmDialog
        open={pending}
        onOpenChange={setPending}
        title={`Delete ${item.name}?`}
        description="This template can no longer be sent."
        onConfirm={() => {
          deleteAndLeave(() => deleteTemplate(item.id))
          toast.add({ type: "success", title: "Template deleted" })
        }}
      />
    </>
  )
}
