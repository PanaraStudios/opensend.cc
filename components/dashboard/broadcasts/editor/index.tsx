"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import {
  CodeXmlIcon,
  HouseIcon,
  MegaphoneIcon,
  PanelRightOpenIcon,
  PencilIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  BroadcastStatusBadge,
  ConfirmDialog,
  NotFoundState,
  useDraft,
} from "@/components/dashboard/primitives"
import { EmailCanvas } from "@/components/dashboard/broadcasts/editor/canvas"
import { EmailEngineProvider } from "@/components/dashboard/broadcasts/editor/engine"
import { SegmentedToggle } from "@/components/dashboard/broadcasts/editor/controls"
import { HtmlMode } from "@/components/dashboard/broadcasts/editor/html-mode"
import { Inspector } from "@/components/dashboard/broadcasts/editor/inspector"
import {
  ReviewPopover,
  TestEmailDialog,
} from "@/components/dashboard/broadcasts/editor/review"
import {
  useBroadcastEditor,
  type SaveState,
} from "@/components/dashboard/broadcasts/editor/use-editor"
import {
  isBroadcastDraftLike,
  type BroadcastEditorMode,
} from "@/lib/dashboard/broadcast"
import { useDashboard, useStoreHydrated } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"

/* Full-screen editor: a top bar, the mode rail, the paper, and the inspector.
   It lives in its own route group so the dashboard sidebar stays out of the
   way, exactly as the reference does. */

const VIEW_ITEMS = [
  { value: "visual" as const, label: "Visual editor", icon: PencilIcon },
  { value: "html" as const, label: "HTML code editor", icon: CodeXmlIcon },
]

function SaveIndicator({ save }: { save: SaveState }) {
  if (save === "idle") return null
  return (
    <span
      className="text-caption text-muted-foreground"
      data-testid="save-indicator"
      aria-live="polite"
    >
      {save === "saving" ? "Saving…" : "Saved"}
    </span>
  )
}

function EditorScreen({ item }: { item: Broadcast }) {
  const { updateBroadcast } = useDashboard()
  const editor = useBroadcastEditor(item)
  const [view, setView] = React.useState<BroadcastEditorMode>(editor.mode)
  const [inspectorOpen, setInspectorOpen] = React.useState(true)
  const [testOpen, setTestOpen] = React.useState(false)
  const [blocksOpen, setBlocksOpen] = React.useState(false)
  const [sendAt, setSendAt] = React.useState<number | null>(item.scheduledAt)
  const name = useDraft(item.name, (value) =>
    updateBroadcast(item.id, { name: value })
  )
  const { undo, redo } = editor

  const handWritten = editor.mode === "html"

  return (
    <EmailEngineProvider editor={editor.editor}>
      <div className="flex h-svh flex-col overflow-hidden bg-background">
        <header
          data-testid="editor-topbar"
          className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            nativeButton={false}
            aria-label="Back to broadcasts"
            data-testid="editor-home"
            render={<Link href="/broadcasts" />}
          >
            <HouseIcon />
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <Link
              href="/broadcasts"
              className="hidden shrink-0 text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              Broadcasts
            </Link>
            <span className="hidden text-sm text-faint-foreground sm:block">
              /
            </span>
            <input
              {...name}
              aria-label="Broadcast name"
              data-testid="editor-name"
              placeholder="Untitled"
              className="max-w-64 min-w-0 rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-muted focus-visible:bg-muted"
            />
            <BroadcastStatusBadge status={item.status} />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SaveIndicator save={editor.save} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo"
              data-testid="editor-undo"
              disabled={!editor.undoable}
              onClick={undo}
            >
              <Undo2Icon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo"
              data-testid="editor-redo"
              disabled={!editor.redoable}
              onClick={redo}
            >
              <Redo2Icon />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="editor-test-email"
              onClick={() => setTestOpen(true)}
            >
              Test email
            </Button>
            <ReviewPopover
              item={item}
              html={editor.html}
              empty={editor.empty}
              sendAt={sendAt}
              flush={editor.flush}
            />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Editor mode"
            className="flex w-12 shrink-0 flex-col items-center border-r border-border py-3"
          >
            <SegmentedToggle
              orientation="vertical"
              value={view}
              items={VIEW_ITEMS}
              aria-label="Editor mode"
              testIdPrefix="mode-toggle"
              onValueChange={setView}
              className="w-auto"
            />
          </nav>

          <main
            className={
              view === "visual"
                ? "min-w-0 flex-1 overflow-auto"
                : "flex min-w-0 flex-1 flex-col overflow-hidden"
            }
          >
            {view === "visual" ? (
              <>
                {handWritten ? (
                  <div
                    data-testid="html-document-banner"
                    className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2"
                  >
                    <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                      This broadcast is hand-written HTML.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="editor-start-from-blocks"
                      onClick={() => setBlocksOpen(true)}
                    >
                      Edit visually
                    </Button>
                  </div>
                ) : (
                  <EmailCanvas
                    item={item}
                    editor={editor.editor}
                    sendAt={sendAt}
                    onSendAtChange={setSendAt}
                  />
                )}
              </>
            ) : (
              <HtmlMode editor={editor} />
            )}
          </main>

          {inspectorOpen ? (
            <Inspector onCollapse={() => setInspectorOpen(false)} />
          ) : (
            <div className="flex shrink-0 flex-col border-l border-border p-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Expand panel"
                data-testid="inspector-expand"
                onClick={() => setInspectorOpen(true)}
              >
                <PanelRightOpenIcon />
              </Button>
            </div>
          )}
        </div>

        <TestEmailDialog
          open={testOpen}
          onOpenChange={setTestOpen}
          item={item}
        />
        <ConfirmDialog
          open={blocksOpen}
          onOpenChange={setBlocksOpen}
          title="Edit this broadcast visually?"
          description="The hand-written HTML is read into the visual editor. Markup it does not understand is dropped."
          confirmLabel="Edit visually"
          onConfirm={editor.editVisually}
        />
      </div>
    </EmailEngineProvider>
  )
}

export function BroadcastEditor() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { state } = useDashboard()
  const hydrated = useStoreHydrated()
  const item = state.broadcasts.find((row) => row.id === id)
  const report = Boolean(item) && !isBroadcastDraftLike(item!.status)

  React.useEffect(() => {
    if (report) router.replace(`/broadcasts/${id}`)
  }, [id, report, router])

  if (!item) {
    return (
      <div className="mx-auto w-full max-w-2xl p-10">
        <NotFoundState
          icon={MegaphoneIcon}
          noun="broadcast"
          backHref="/broadcasts"
        />
      </div>
    )
  }
  /* The editor copies the document into the engine when it mounts, so it
     waits for the saved one rather than starting from the seed. */
  if (report || !hydrated) return null

  return <EditorScreen key={item.id} item={item} />
}
