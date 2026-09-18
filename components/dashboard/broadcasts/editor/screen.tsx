"use client"

import * as React from "react"
import Link from "next/link"
import {
  CodeXmlIcon,
  HouseIcon,
  PanelRightOpenIcon,
  PencilIcon,
  Redo2Icon,
  Undo2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { SegmentedToggle } from "@/components/ui/segmented-toggle"
import {
  ConfirmDialog,
  NotFoundState,
  useDraft,
} from "@/components/dashboard/primitives"
import { EmailCanvas } from "@/components/dashboard/broadcasts/editor/canvas"
import {
  EmailEngineProvider,
  storedPreset,
} from "@/components/dashboard/broadcasts/editor/engine"
import { EmailHeaderForm } from "@/components/dashboard/broadcasts/editor/header-form"
import { HtmlMode } from "@/components/dashboard/broadcasts/editor/html-mode"
import { Inspector } from "@/components/dashboard/broadcasts/editor/inspector"
import { TestEmailDialog } from "@/components/dashboard/broadcasts/editor/review"
import {
  useEmailEditor,
  type EmailEditorState,
  type SaveState,
} from "@/components/dashboard/broadcasts/editor/use-editor"
import type { EmailEditorMode } from "@/lib/dashboard/broadcast"
import { sentenceCase } from "@/lib/dashboard/format"
import type { EmailDraft } from "@/lib/dashboard/types"

/* Full-screen editor: a top bar, the mode rail, the paper, and the inspector.
   It lives in its own route group so the dashboard sidebar stays out of the
   way, exactly as the reference does. Broadcasts and templates both open in
   it; what differs between them comes in as props. */

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

type EmailEditorScreenProps = {
  item: EmailDraft
  /** What the email is called in copy: "broadcast", "template". */
  noun: string
  listHref: string
  listLabel: string
  badge: React.ReactNode
  /** Envelope rows only this kind of email has, under the sender. */
  headerExtra?: React.ReactNode
  /** The top bar's closing actions: a send, a publish. */
  actions: (editor: EmailEditorState) => React.ReactNode
  /** Stores an edit on the record the email belongs to. */
  onChange: (patch: Partial<Omit<EmailDraft, "id">>) => void
}

/* The engine is built on a theme preset and cannot change it afterwards, so
   the screen is keyed by the preset the document asks for and mounts again
   when that changes. State that must outlive that belongs to the caller. */
export function EmailEditorScreen(props: EmailEditorScreenProps) {
  const preset = storedPreset(props.item.content)
  const [first] = React.useState(preset)
  const [changed, setChanged] = React.useState(false)
  if (!changed && preset !== first) setChanged(true)
  return <EditorScreen key={preset} {...props} presetChanged={changed} />
}

/** An editor route whose record is gone. */
export function EditorNotFound(
  props: React.ComponentProps<typeof NotFoundState>
) {
  return (
    <div className="mx-auto w-full max-w-2xl p-10">
      <NotFoundState {...props} />
    </div>
  )
}

function EditorScreen({
  item,
  presetChanged,
  noun,
  listHref,
  listLabel,
  badge,
  headerExtra,
  actions,
  onChange,
}: EmailEditorScreenProps & {
  /** This mount replaces one on another theme preset, so the saved markup
      was exported under the old one. */
  presetChanged: boolean
}) {
  const editor = useEmailEditor(item, onChange, presetChanged)
  const [view, setView] = React.useState<EmailEditorMode>(editor.mode)
  const [inspectorOpen, setInspectorOpen] = React.useState(true)
  const collapseInspector = React.useCallback(() => setInspectorOpen(false), [])
  const [testOpen, setTestOpen] = React.useState(false)
  const [blocksOpen, setBlocksOpen] = React.useState(false)
  const name = useDraft(item.name, (value) => onChange({ name: value }))
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
            aria-label={`Back to ${listLabel.toLowerCase()}`}
            data-testid="editor-home"
            render={<Link href={listHref} />}
          >
            <HouseIcon />
          </Button>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            <Link
              href={listHref}
              className="hidden shrink-0 text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              {listLabel}
            </Link>
            <span className="hidden text-sm text-faint-foreground sm:block">
              /
            </span>
            <input
              {...name}
              aria-label={`${sentenceCase(noun)} name`}
              data-testid="editor-name"
              placeholder="Untitled"
              className="max-w-64 min-w-0 rounded-md bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:bg-muted focus-visible:bg-muted"
            />
            {badge}
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
            {actions(editor)}
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
              onValueChange={(next) => {
                /* The HTML view shows the export, so it is brought up to date. */
                if (next === "html") void editor.flush()
                setView(next)
              }}
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
            {view !== "visual" ? (
              <HtmlMode editor={editor} />
            ) : handWritten ? (
              <div
                data-testid="html-document-banner"
                className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-2"
              >
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  This {noun} is hand-written HTML.
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
                editor={editor.editor}
                header={
                  <EmailHeaderForm item={item} onChange={onChange}>
                    {headerExtra}
                  </EmailHeaderForm>
                }
              />
            )}
          </main>

          {/* The panel edits the visual document. With the markup on screen,
              or an email that is hand-written, there is nothing for it to
              act on, and a change made there would silently go nowhere. */}
          {view !== "visual" || handWritten ? null : inspectorOpen ? (
            <Inspector onCollapse={collapseInspector} />
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
          exportHtml={editor.exportHtml}
        />
        <ConfirmDialog
          open={blocksOpen}
          onOpenChange={setBlocksOpen}
          title={`Edit this ${noun} visually?`}
          description="The hand-written HTML is read into the visual editor. Markup it does not understand is dropped."
          confirmLabel="Edit visually"
          onConfirm={editor.editVisually}
        />
      </div>
    </EmailEngineProvider>
  )
}
