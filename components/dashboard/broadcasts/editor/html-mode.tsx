"use client"

import * as React from "react"
import { pretty } from "@react-email/render"
import { PencilIcon, WandSparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ConfirmDialog } from "@/components/dashboard/primitives"
import { CodeEditor } from "@/components/dashboard/broadcasts/editor/code-editor"
import { EmailPreviewFrame } from "@/components/dashboard/broadcasts/editor/preview"
import {
  useEmailHtml,
  type BroadcastEditorState,
} from "@/components/dashboard/broadcasts/editor/use-editor"
import {
  documentRawHtml,
  htmlEmailDocument,
  type HtmlBlock,
} from "@/lib/dashboard/email-document"
import type { Broadcast } from "@/lib/dashboard/types"

/* Two ways to reach this pane. A block document shows the markup React Email
   produced, read-only, because editing it by hand is a one-way door: taking
   that door replaces the blocks with a single HTML block, which is exactly
   what a pasted or uploaded document is. */
export function HtmlMode({
  item,
  editor,
}: {
  item: Broadcast
  editor: BroadcastEditorState
}) {
  const { doc, apply } = editor
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const rendered = useEmailHtml(doc, item.preview)
  const handWritten = doc.mode === "html"
  const code = handWritten ? documentRawHtml(doc) : rendered

  function setCode(next: string) {
    apply((current) => {
      const block = current.blocks[0]
      if (!block || block.type !== "html") return current
      return {
        ...current,
        blocks: [{ ...(block as HtmlBlock), code: next }],
      }
    })
  }

  return (
    <>
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="50" minSize="25">
          <div
            className="flex h-full min-h-0 flex-col gap-2 p-4"
            data-testid="html-mode"
          >
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                HTML code editor
              </h2>
              {handWritten ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Format HTML"
                  data-testid="html-format"
                  onClick={() => {
                    void pretty(code).then(setCode)
                  }}
                >
                  <WandSparklesIcon />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="html-edit"
                  onClick={() => setConfirmOpen(true)}
                >
                  <PencilIcon data-icon="inline-start" />
                  Edit HTML
                </Button>
              )}
            </div>
            {handWritten ? null : (
              <p className="text-caption text-muted-foreground">
                This markup is generated from your blocks.
              </p>
            )}
            <CodeEditor
              value={code}
              readOnly={!handWritten}
              aria-label="HTML code editor"
              data-testid="html-code"
              placeholder="Start writing your broadcast..."
              className="min-h-0 flex-1"
              onValueChange={setCode}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="50" minSize="25">
          <EmailPreviewFrame
            title="Email preview"
            data-testid="html-preview"
            html={handWritten ? code : rendered}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Edit this broadcast as HTML?"
        description="Your blocks are replaced by a single HTML block holding the markup below. You can start again from blocks at any time."
        confirmLabel="Edit HTML"
        onConfirm={() =>
          apply((current) => htmlEmailDocument(rendered, current))
        }
      />
    </>
  )
}
