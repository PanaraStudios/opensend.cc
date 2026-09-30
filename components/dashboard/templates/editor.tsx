"use client"

import { useParams, useRouter } from "next/navigation"
import { FileCodeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import {
  EditorNotFound,
  EmailEditorScreen,
} from "@/components/dashboard/broadcasts/editor/screen"
import {
  TemplateStatusBadge,
  useDeleteRecord,
} from "@/components/dashboard/primitives"
import {
  TemplateMenu,
  usePublishTemplate,
} from "@/components/dashboard/templates/shared"
import { actionError } from "@/lib/action-error"
import { templatePublishLabel } from "@/lib/dashboard/template"
import type { EmailTemplate } from "@/lib/dashboard/types"
import {
  useTemplate,
  useTemplateCommands,
  useTemplateSaver,
} from "@/lib/templates/use-templates"

export function TemplateEditor() {
  const { id } = useParams<{ id: string }>()
  const item = useTemplate(id)
  const { deleteTemplate } = useTemplateCommands()
  const { leaving, deleteAndLeave } = useDeleteRecord("/templates")

  /* The editor copies the document into the engine when it mounts, so it
     waits for the stored one rather than starting empty. */
  if (item === undefined) return null

  if (!item) {
    if (leaving) return null
    return (
      <EditorNotFound
        icon={FileCodeIcon}
        noun="template"
        backHref="/templates"
      />
    )
  }

  return (
    <TemplateEditorScreen
      key={item.id}
      item={item}
      onDelete={() =>
        deleteAndLeave(
          () =>
            void deleteTemplate(item.id).catch((error) =>
              toast.add({ type: "error", title: actionError(error) })
            )
        )
      }
    />
  )
}

function TemplateEditorScreen({
  item,
  onDelete,
}: {
  item: EmailTemplate
  onDelete: () => void
}) {
  const router = useRouter()
  const save = useTemplateSaver(item)
  const publish = usePublishTemplate()
  const publishLabel = templatePublishLabel(item)

  return (
    <EmailEditorScreen
      item={item}
      noun="template"
      listHref="/templates"
      listLabel="Templates"
      badge={<TemplateStatusBadge status={item.status} />}
      onChange={save}
      actions={(editor) => (
        <>
          <TemplateMenu
            item={item}
            inEditor
            save={editor.flush}
            onDuplicated={(next) => router.push(`/templates/${next}`)}
            onDelete={onDelete}
          />
          <Button
            size="sm"
            data-testid="editor-publish"
            disabled={!publishLabel || editor.empty}
            onClick={async () => {
              /* What goes live is the email on screen, so it is saved first. */
              if (await editor.flush()) await publish(item.id)
            }}
          >
            {publishLabel ?? "Published"}
          </Button>
        </>
      )}
    />
  )
}
