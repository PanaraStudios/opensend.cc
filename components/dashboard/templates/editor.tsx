"use client"

import { useParams, useRouter } from "next/navigation"
import { FileCodeIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { useDashboard, useStoreHydrated } from "@/lib/dashboard/store"
import { templatePublishLabel } from "@/lib/dashboard/template"

export function TemplateEditor() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state, updateTemplate, deleteTemplate } = useDashboard()
  const hydrated = useStoreHydrated()
  const publish = usePublishTemplate()
  const { leaving, deleteAndLeave } = useDeleteRecord("/templates")
  const item = state.templates.find((row) => row.id === id)

  /* The editor copies the document into the engine when it mounts, so it
     waits for the saved one rather than starting from the seed. */
  if (!hydrated) return null

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

  const publishLabel = templatePublishLabel(item)

  return (
    <EmailEditorScreen
      key={item.id}
      item={item}
      noun="template"
      listHref="/templates"
      listLabel="Templates"
      badge={<TemplateStatusBadge status={item.status} />}
      onChange={(patch) => updateTemplate(item.id, patch)}
      actions={(editor) => (
        <>
          <TemplateMenu
            item={item}
            inEditor
            save={editor.flush}
            onDuplicated={(next) => router.push(`/templates/${next}`)}
            onDelete={() => deleteAndLeave(() => deleteTemplate(item.id))}
          />
          <Button
            size="sm"
            data-testid="editor-publish"
            disabled={!publishLabel || editor.empty}
            onClick={async () => {
              /* What goes live is the email on screen, so it is saved first. */
              if (await editor.flush()) publish(item.id)
            }}
          >
            {publishLabel ?? "Published"}
          </Button>
        </>
      )}
    />
  )
}
