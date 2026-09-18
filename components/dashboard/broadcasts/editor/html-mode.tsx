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
import type { BroadcastEditorState } from "@/components/dashboard/broadcasts/editor/use-editor"

/* Two ways to reach this pane. A visual document shows the markup React Email
   exported, read-only, because editing it by hand is a one-way door: taking
   that door drops the editor document and makes this markup the email. */
export function HtmlMode({ editor }: { editor: BroadcastEditorState }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const handWritten = editor.mode === "html"
  const code = editor.html
  const setCode = editor.setHtml

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
                This markup is generated from the visual editor.
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
            html={code}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Edit this broadcast as HTML?"
        description="The markup below becomes the email, and the visual document is dropped. You can go back to the visual editor, which keeps what it understands."
        confirmLabel="Edit HTML"
        onConfirm={editor.editAsHtml}
      />
    </>
  )
}
