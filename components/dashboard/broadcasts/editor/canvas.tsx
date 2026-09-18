"use client"

import * as React from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  type SortingStrategy,
} from "@dnd-kit/sortable"
import { LayoutTemplateIcon, UploadIcon } from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CanvasBlock } from "@/components/dashboard/broadcasts/editor/block"
import {
  paletteItem,
  type PaletteItem,
} from "@/components/dashboard/broadcasts/editor/blocks"
import {
  CanvasActionsProvider,
  type CanvasActions,
} from "@/components/dashboard/broadcasts/editor/context"
import {
  focusBlockEditor,
  hasActiveEditable,
  insertIntoEditable,
} from "@/components/dashboard/broadcasts/editor/editable"
import { EmailHeaderForm } from "@/components/dashboard/broadcasts/editor/header-form"
import { InsertRail } from "@/components/dashboard/broadcasts/editor/palette"
import type { BroadcastEditorState } from "@/components/dashboard/broadcasts/editor/use-editor"
import {
  containerBlocks,
  createEmailBlock,
  duplicateBlock,
  findBlock,
  formatVariable,
  htmlEmailDocument,
  insertBlock,
  isDocumentEmpty,
  moveBlock,
  moveBlockBy,
  removeBlock,
  ROOT_CONTAINER,
  updateBlock,
  type ContainerKey,
  type EmailBlock,
  type EmailDocument,
  type EmailVariable,
  type TextBlock,
} from "@/lib/dashboard/email-document"
import { bodyStyle, documentCss, pageStyle } from "@/lib/dashboard/email-render"
import { useDashboard } from "@/lib/dashboard/store"
import type { Broadcast } from "@/lib/dashboard/types"
import { cn } from "@/lib/utils"

/* Drag and drop is one `DndContext` over the whole paper. Every list — the
   root and each column — is its own droppable plus `SortableContext`, so the
   same machinery reorders blocks, moves them between columns, and accepts new
   blocks dragged out of the insert rail. */

const CONTAINER_PREFIX = "container:"

type DropTarget = { container: ContainerKey; index: number }

function containerDroppableId(container: ContainerKey): string {
  return `${CONTAINER_PREFIX}${container}`
}

function containerFromDroppableId(id: string): ContainerKey | null {
  return id.startsWith(CONTAINER_PREFIX)
    ? id.slice(CONTAINER_PREFIX.length)
    : null
}

/* Blocks stay where they are while one is dragged. The drop indicator is the
   only preview, so what the user sees is exactly where the block lands — the
   default strategy shuffles siblings, which moved the rects being measured. */
const keepInPlace: SortingStrategy = () => null

/* Droppables nest: the root list holds blocks, a columns block holds column
   lists, and those hold blocks again. The innermost list under the pointer
   decides. Inside it a block under the pointer wins (drop beside it); over
   the list's empty space the list itself wins (drop at its end). Without the
   "innermost" step a columns block swallowed every drop aimed at its columns. */
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  const candidates = pointer.length > 0 ? pointer : rectIntersection(args)
  const isList = (id: unknown) => String(id).startsWith(CONTAINER_PREFIX)
  const lists = candidates.filter((collision) => isList(collision.id))
  const area = (collision: (typeof candidates)[number]) => {
    const rect = collision.data?.droppableContainer?.rect.current
    return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY
  }
  const innermost = [...lists].sort((a, b) => area(a) - area(b))[0]
  if (!innermost) return candidates
  const key = containerFromDroppableId(String(innermost.id))
  const blocks = candidates.filter(
    (collision) =>
      !isList(collision.id) &&
      collision.data?.droppableContainer?.data.current?.container === key
  )
  return blocks.length > 0 ? blocks : [innermost]
}

function DropIndicator() {
  return (
    <div
      data-testid="drop-indicator"
      aria-hidden="true"
      className="pointer-events-none -my-px h-0.5 rounded-full bg-[#2563eb]"
    />
  )
}

function BlockList({
  container,
  blocks,
  dropTarget,
  emptyHint,
  className,
}: {
  container: ContainerKey
  blocks: readonly EmailBlock[]
  dropTarget: DropTarget | null
  emptyHint?: React.ReactNode
  className?: string
}) {
  const { setNodeRef } = useDroppable({
    id: containerDroppableId(container),
    data: { container },
  })
  const at = dropTarget?.container === container ? dropTarget.index : -1

  return (
    <SortableContext
      id={container}
      items={blocks.map((block) => block.id)}
      strategy={keepInPlace}
    >
      <div
        ref={setNodeRef}
        data-testid="drop-zone"
        data-container={container}
        className={cn("flex min-h-6 flex-col", className)}
      >
        {blocks.map((block, index) => (
          <React.Fragment key={block.id}>
            {at === index ? <DropIndicator /> : null}
            <CanvasBlock block={block} container={container} />
          </React.Fragment>
        ))}
        {at === blocks.length ? <DropIndicator /> : null}
        {blocks.length === 0 ? emptyHint : null}
      </div>
    </SortableContext>
  )
}

function EmptyColumn() {
  return (
    <div className="flex min-h-16 items-center justify-center rounded-md border border-dashed border-[#d7dce1] text-[12px] text-[#9ca3af]">
      Drop a block
    </div>
  )
}

function TemplatePicker({
  onPick,
}: {
  onPick: (html: string, subject: string) => void
}) {
  const { state } = useDashboard()
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="canvas-pick-template"
            className="flex items-center gap-2 rounded-md px-1 py-1 text-[14px] text-[#6b7280] outline-none hover:text-[#111827] focus-visible:text-[#111827]"
          />
        }
      >
        <LayoutTemplateIcon className="size-4" />
        Pick a template
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search templates…" />
          <CommandList>
            <CommandEmpty>No templates yet.</CommandEmpty>
            <CommandGroup heading="Templates">
              {state.templates.map((template) => (
                <CommandItem
                  key={template.id}
                  value={template.name}
                  data-testid={`template-${template.id}`}
                  onSelect={() => {
                    onPick(template.html, template.subject)
                    setOpen(false)
                  }}
                >
                  {template.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CanvasEmptyState({
  onStartWriting,
  onHtml,
  onPickTemplate,
}: {
  onStartWriting: () => void
  onHtml: (html: string) => void
  onPickTemplate: (html: string, subject: string) => void
}) {
  return (
    <div data-testid="canvas-empty" className="flex flex-col gap-1 pt-3">
      <button
        type="button"
        data-testid="canvas-start-writing"
        className="rounded-md px-1 py-1 text-left text-[14px] text-[#9ca3af] outline-none hover:text-[#6b7280] focus-visible:text-[#6b7280]"
        onClick={onStartWriting}
      >
        Press &apos;/&apos; for commands…
      </button>
      <TemplatePicker onPick={onPickTemplate} />
      <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[14px] text-[#6b7280] hover:text-[#111827]">
        <UploadIcon className="size-4" />
        Upload HTML or
        <Kbd className="border-[#e5e7eb] bg-[#f3f4f6] text-[#6b7280]">⌘</Kbd>
        <Kbd className="border-[#e5e7eb] bg-[#f3f4f6] text-[#6b7280]">V</Kbd>
        <input
          type="file"
          accept=".html,.htm,text/html"
          className="sr-only"
          data-testid="canvas-upload-html"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            void file.text().then(onHtml)
            event.target.value = ""
          }}
        />
      </label>
    </div>
  )
}

/** A text block holding just a variable token. */
function variableBlock(name: string, fallback?: string): TextBlock {
  return {
    ...(createEmailBlock("text") as TextBlock),
    html: formatVariable(name, fallback),
  }
}

export function EmailCanvas({
  item,
  editor,
  sendAt,
  onSendAtChange,
}: {
  item: Broadcast
  editor: BroadcastEditorState
  sendAt: number | null
  onSendAtChange: (value: number | null) => void
}) {
  const { updateBroadcast } = useDashboard()
  const { doc, apply, select } = editor
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null)
  const [dragLabel, setDragLabel] = React.useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const insertAt = React.useCallback(
    (block: EmailBlock, container: ContainerKey, index: number) => {
      apply((current) => insertBlock(current, block, container, index))
      select(block.id)
      focusBlockEditor(block.id)
    },
    [apply, select]
  )

  /** Appends after the selection when there is one, else at the end. */
  const insertBlockAtCursor = React.useCallback(
    (block: EmailBlock) => {
      const found = editor.selectedId ? findBlock(doc, editor.selectedId) : null
      const container = found?.container ?? ROOT_CONTAINER
      const index = found
        ? found.index + 1
        : containerBlocks(doc, ROOT_CONTAINER).length
      insertAt(block, container, index)
    },
    [doc, editor.selectedId, insertAt]
  )

  const loadHtml = React.useCallback(
    (html: string) => {
      apply((current) => htmlEmailDocument(html, current))
      select(null)
    },
    [apply, select]
  )

  const actions = React.useMemo<CanvasActions>(
    () => ({
      theme: doc.theme,
      selectedId: editor.selectedId,
      select,
      update: (id, patch) =>
        apply((current) => updateBlock(current, id, patch)),
      remove: (id) => {
        apply((current) => removeBlock(current, id))
        select(null)
      },
      duplicate: (id) => {
        const next = duplicateBlock(doc, id)
        apply(next.doc)
        select(next.id)
      },
      moveBy: (id, delta) =>
        apply((current) => moveBlockBy(current, id, delta)),
      insertAfter: (id, block) => {
        const found = findBlock(doc, id)
        if (!found) return
        insertAt(block, found.container, found.index + 1)
      },
      replace: (id, block) => {
        const found = findBlock(doc, id)
        if (!found) return
        apply(
          insertBlock(removeBlock(doc, id), block, found.container, found.index)
        )
        select(block.id)
        focusBlockEditor(block.id)
      },
      renderContainer: (container, blocks) => (
        <BlockList
          container={container}
          blocks={blocks}
          dropTarget={dropTarget}
          emptyHint={<EmptyColumn />}
          className="gap-1"
        />
      ),
    }),
    [apply, doc, dropTarget, editor.selectedId, insertAt, select]
  )

  const paperCss = React.useMemo(
    () => ({ __html: documentCss(doc, "#email-paper") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only these two feed the stylesheet
    [doc.theme, doc.globalCss]
  )

  function resolveTarget(
    current: EmailDocument,
    overId: string,
    after: boolean
  ): DropTarget | null {
    const container = containerFromDroppableId(overId)
    if (container) {
      return { container, index: containerBlocks(current, container).length }
    }
    const found = findBlock(current, overId)
    if (!found) return null
    return { container: found.container, index: found.index + (after ? 1 : 0) }
  }

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current ?? {}
    if (typeof data.paletteId === "string") {
      setDragLabel(paletteItem(data.paletteId)?.label ?? "Block")
      return
    }
    if (typeof data.variable === "string") {
      setDragLabel(data.variable)
      return
    }
    setDragLabel("Block")
  }

  /* Runs on every pointer move as well as on `over` changes: dnd-kit only
     fires `onDragOver` when the hovered block changes, which would freeze the
     before/after side at whatever it was when the pointer entered the block. */
  function onDragOver(event: DragOverEvent | DragMoveEvent) {
    const { active, over } = event
    if (!over) {
      setDropTarget(null)
      return
    }
    /* The side follows the pointer, not the dragged block's centre: a block
       is held by the handle on its corner, so its centre sits well below the
       cursor. Keyboard drags have no pointer and fall back to the rect. */
    const start = event.activatorEvent
    const activeRect = active.rect.current.translated
    const y =
      "clientY" in start && typeof start.clientY === "number"
        ? start.clientY + event.delta.y
        : activeRect
          ? activeRect.top + activeRect.height / 2
          : null
    const after = y !== null && y > over.rect.top + over.rect.height / 2
    const next = resolveTarget(doc, String(over.id), after)
    setDropTarget((current) =>
      current?.container === next?.container && current?.index === next?.index
        ? current
        : next
    )
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const target = dropTarget
    setDropTarget(null)
    setDragLabel(null)
    if (!over || !target) return
    const data = active.data.current ?? {}

    if (typeof data.paletteId === "string") {
      const entry = paletteItem(data.paletteId)
      if (entry) insertAt(entry.create(), target.container, target.index)
      return
    }
    if (typeof data.variable === "string") {
      const fallback = typeof data.fallback === "string" ? data.fallback : ""
      insertAt(
        variableBlock(data.variable, fallback),
        target.container,
        target.index
      )
      return
    }
    /* `target.index` is where the indicator sits in the list as it stands.
       Pulling the block out first shifts everything after it up by one. */
    const found = findBlock(doc, String(active.id))
    const index =
      found &&
      found.container === target.container &&
      found.index < target.index
        ? target.index - 1
        : target.index
    apply(moveBlock(doc, String(active.id), target.container, index))
  }

  /* An empty canvas takes a pasted HTML document. The listener is on the
     window because the empty state is not a focusable paste target. */
  React.useEffect(() => {
    if (!isDocumentEmpty(doc)) return
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return
      }
      const text = event.clipboardData?.getData("text/plain") ?? ""
      if (!/<[a-z][\s\S]*>/i.test(text)) return
      event.preventDefault()
      loadHtml(text)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [doc, loadHtml])

  function insertVariable(variable: EmailVariable) {
    const token = formatVariable(variable.name, variable.fallback)
    if (hasActiveEditable() && insertIntoEditable(token)) return
    insertBlockAtCursor(variableBlock(variable.name, variable.fallback))
  }

  function insertPalette(entry: PaletteItem) {
    insertBlockAtCursor(entry.create())
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragMove={onDragOver}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDropTarget(null)
        setDragLabel(null)
      }}
    >
      <div
        className="relative flex min-h-full justify-center"
        style={pageStyle(doc)}
        data-testid="editor-canvas"
        onPointerDown={() => select(null)}
      >
        {/* A hand-written document is sent as its raw markup, so a block
            added beside it would show here and never reach the email. */}
        {doc.mode === "html" ? null : (
          <InsertRail
            className="absolute top-24 left-4 z-30 md:left-8"
            onInsertBlock={insertPalette}
            onInsertVariable={insertVariable}
          />
        )}
        <div
          id="email-paper"
          data-testid="email-paper"
          style={bodyStyle(doc)}
          className="relative"
        >
          {/* The same theme stylesheet the email gets, then the author's
              Global CSS, both scoped to the paper so neither reaches the
              dashboard around it. */}
          <style dangerouslySetInnerHTML={paperCss} />
          <EmailHeaderForm
            item={item}
            sendAt={sendAt}
            onSendAtChange={onSendAtChange}
          />
          <CanvasActionsProvider value={actions}>
            <BlockList
              container={ROOT_CONTAINER}
              blocks={doc.blocks}
              dropTarget={dropTarget}
              className="pt-3"
              emptyHint={
                <CanvasEmptyState
                  onStartWriting={() =>
                    insertAt(createEmailBlock("text"), ROOT_CONTAINER, 0)
                  }
                  onHtml={loadHtml}
                  onPickTemplate={(html, subject) => {
                    loadHtml(html)
                    if (!item.subject.trim() && subject) {
                      updateBroadcast(item.id, { subject })
                    }
                  }}
                />
              }
            />
          </CanvasActionsProvider>
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragLabel ? (
          <div
            data-testid="drag-overlay"
            className="pointer-events-none rounded-lg border border-border bg-popover px-2.5 py-1.5 text-sm shadow-float"
          >
            {dragLabel}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
