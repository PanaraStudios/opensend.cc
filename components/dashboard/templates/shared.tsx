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
import { EmailPreviewFrame } from "@/components/dashboard/broadcasts/editor/preview"
import {
  ConfirmDialog,
  MoreMenu,
  TextFieldDialog,
  type SelectOption,
} from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import { templateStatusLabel } from "@/lib/dashboard/format"
import {
  templateAliasError,
  templatePublishLabel,
} from "@/lib/dashboard/template"
import type { EmailTemplate } from "@/lib/dashboard/types"
import { useTemplateCommands } from "@/lib/templates/use-templates"

/* The email itself, drawn small: a 600px sheet at half size, cut off by the
   card. It is a picture of the template, so it takes no clicks or focus. */
export function TemplateThumbnail({
  item,
}: {
  item: Pick<EmailTemplate, "name" | "html">
}) {
  return (
    <div
      inert
      className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted"
    >
      <div className="absolute top-[18%] left-1/2 h-[200%] w-[600px] origin-top -translate-x-1/2 scale-50 overflow-hidden rounded-t-2xl bg-white shadow-panel">
        {item.html.trim() ? (
          <EmailPreviewFrame html={item.html} title={item.name} />
        ) : null}
      </div>
    </div>
  )
}

export const TEMPLATE_STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...(["draft", "published"] as const).map((value) => ({
    value,
    label: templateStatusLabel(value),
  })),
]

/** Runs a template command, and says how it went. */
async function report(run: () => Promise<unknown>, title: string) {
  try {
    await run()
    toast.add({ type: "success", title })
  } catch (error) {
    toast.add({ type: "error", title: actionError(error) })
  }
}

export function usePublishTemplate() {
  const { publishTemplate } = useTemplateCommands()
  return (id: string) => report(() => publishTemplate(id), "Template published")
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
    updateTemplate,
    duplicateTemplate,
    unpublishTemplate,
    deleteTemplate,
  } = useTemplateCommands()
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
              await report(async () => {
                const created = await duplicateTemplate(item.id)
                onDuplicated?.(created)
              }, "Template duplicated")
            }}
          >
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          {!inEditor && publishLabel ? (
            <DropdownMenuItem onClick={() => void publish(item.id)}>
              <RocketIcon />
              {publishLabel}
            </DropdownMenuItem>
          ) : null}
          {item.status === "published" ? (
            <DropdownMenuItem
              onClick={() =>
                void report(
                  () => unpublishTemplate(item.id),
                  "Template unpublished"
                )
              }
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
        // The server knows every alias; it answers for the ones taken.
        validate={(alias) => templateAliasError(alias, [])}
        onSubmit={async (alias) => {
          await updateTemplate(item.id, { alias })
          toast.add({ type: "success", title: "Alias updated" })
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${item.name}?`}
        description="Emails already sent keep their rendered copy. New API calls cannot use this template."
        onConfirm={async () => {
          if (onDelete) onDelete()
          else await deleteTemplate(item.id)
          toast.add({ type: "success", title: "Template deleted" })
        }}
      />
    </>
  )
}
