"use client"

import * as React from "react"
import Link from "next/link"
import {
  AtSignIcon,
  CopyIcon,
  PencilIcon,
  RocketIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"

import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import {
  ConfirmDialog,
  DocsCode,
  DocsSheet,
  MoreMenu,
  TextFieldDialog,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { templateStatusLabel } from "@/lib/dashboard/format"
import { useDashboard } from "@/lib/dashboard/store"
import {
  templateAliasError,
  templatePublishLabel,
} from "@/lib/dashboard/template"
import type { EmailTemplate } from "@/lib/dashboard/types"

export const TEMPLATE_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...(["draft", "published"] as const).map((value) => ({
    value,
    label: templateStatusLabel(value),
  })),
]

const TEMPLATE_DOCS = [
  {
    title: "Create",
    body: "Design a reusable email once. It stays a draft until you publish it, and the API only ever sends the published version.",
  },
  {
    title: "Variables",
    body: "Write {{{NAME}}} or {{{NAME|fallback}}} anywhere in the subject or the body, and pass the values with each send.",
  },
  {
    title: "API",
    body: (
      <DocsCode>
        {`POST /emails
{
  "from": "Acme <hello@acme.com>",
  "to": "ada@example.com",
  "template": {
    "id": "welcome",
    "variables": { "FIRST_NAME": "Ada" }
  }
}`}
      </DocsCode>
    ),
  },
]

export function TemplatesDocsSheet(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DocsSheet
      {...props}
      title="Templates"
      description="Reusable emails, sent through the API by id or alias."
      sections={TEMPLATE_DOCS}
    />
  )
}

export function usePublishTemplate() {
  const { setTemplateStatus } = useDashboard()
  return React.useCallback(
    (id: string) => {
      setTemplateStatus(id, "published")
      toast.add({ type: "success", title: "Template published" })
    },
    [setTemplateStatus]
  )
}

/** The "…" menu of one template, with the dialogs it opens. The list's card,
    its table row and the editor's top bar all use it. */
export function TemplateMenu({
  item,
  inEditor = false,
  save,
  onDuplicated,
  onDelete,
}: {
  item: EmailTemplate
  /** The editor links nowhere, and publishes from its own button, which
      saves what is on screen first. */
  inEditor?: boolean
  /** Saves what is on screen. The editor passes its flush, so a copy made
      mid-edit is a copy of the email as it stands. */
  save?: () => Promise<boolean>
  onDuplicated?: (id: string) => void
  /** Replaces the plain delete, for a screen that has to leave first. */
  onDelete?: () => void
}) {
  const {
    state,
    updateTemplate,
    duplicateTemplate,
    setTemplateStatus,
    deleteTemplate,
  } = useDashboard()
  const publish = usePublishTemplate()
  const [aliasOpen, setAliasOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const publishLabel = templatePublishLabel(item)

  return (
    <>
      <MoreMenu>
        <DropdownMenuGroup>
          {inEditor ? null : (
            <DropdownMenuItem render={<Link href={`/templates/${item.id}`} />}>
              <PencilIcon />
              Edit template
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setAliasOpen(true)}>
            <AtSignIcon />
            Edit alias
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              if (save && !(await save())) return
              const created = duplicateTemplate(item.id)
              if (!created) return
              toast.add({ type: "success", title: "Template duplicated" })
              onDuplicated?.(created.id)
            }}
          >
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          {!inEditor && publishLabel ? (
            <DropdownMenuItem onClick={() => publish(item.id)}>
              <RocketIcon />
              {publishLabel}
            </DropdownMenuItem>
          ) : null}
          {item.status === "published" ? (
            <DropdownMenuItem
              onClick={() => {
                setTemplateStatus(item.id, "draft")
                toast.add({ type: "success", title: "Template unpublished" })
              }}
            >
              <Undo2Icon />
              Revert to draft
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </MoreMenu>
      <TextFieldDialog
        open={aliasOpen}
        onOpenChange={setAliasOpen}
        title="Edit alias"
        description="A readable handle the API can send this template by, in place of its id."
        label="Alias"
        mono
        value={item.alias}
        validate={(alias) =>
          templateAliasError(
            alias,
            state.templates.filter((other) => other.id !== item.id)
          )
        }
        onSubmit={(alias) => {
          updateTemplate(item.id, { alias })
          toast.add({ type: "success", title: "Alias updated" })
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${item.name}?`}
        description="Emails already sent keep their rendered copy. New API calls cannot use this template."
        onConfirm={() => {
          if (onDelete) onDelete()
          else deleteTemplate(item.id)
          toast.add({ type: "success", title: "Template deleted" })
        }}
      />
    </>
  )
}
