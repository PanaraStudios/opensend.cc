"use client"

import * as React from "react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoldIcon,
  CopyIcon,
  GripVerticalIcon,
  ImageIcon,
  ItalicIcon,
  Link2Icon,
  Trash2Icon,
} from "lucide-react"

import { YouTubeIcon } from "@/components/brand-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { blockEntry } from "@/components/dashboard/broadcasts/editor/blocks"
import { useCanvasActions } from "@/components/dashboard/broadcasts/editor/context"
import {
  InlineEditable,
  runEditableCommand,
} from "@/components/dashboard/broadcasts/editor/editable"
import { SlashMenu } from "@/components/dashboard/broadcasts/editor/slash-menu"
import {
  columnContainerKey,
  createEmailBlock,
  UNSUBSCRIBE_VARIABLE,
  type ButtonBlock,
  type ColumnsBlock,
  type ContainerKey,
  type EmailBlock,
  type FooterBlock,
  type HeadingBlock,
  type ListBlock,
  type TextBlock,
} from "@/lib/dashboard/email-document"
import {
  blockStyle,
  blockWrapperStyle,
  youtubeThumbnail,
} from "@/lib/dashboard/email-render"

/* The canvas paints blocks with the very inline styles the email will use, so
   what is on screen is what `renderEmailDocument` emits. Selection chrome is
   drawn around that box in fixed paper-friendly colours, because the paper
   keeps the email's own palette in both app themes. */

const SELECTED_RING = "0 0 0 2px #2563eb"
const HOVER_RING = "0 0 0 1px #c3cad2"
const PAPER_HINT =
  "flex items-center justify-center gap-2 rounded-md border border-dashed border-[#c3cad2] p-6 text-[13px] text-[#6b7280]"

function LinkPopover({ onApply }: { onApply: (href: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const [href, setHref] = React.useState("https://")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Link"
            data-testid="block-link"
          />
        }
      >
        <Link2Icon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            onApply(href)
            setOpen(false)
          }}
        >
          <Input
            value={href}
            autoFocus
            aria-label="Link URL"
            data-testid="block-link-url"
            className="h-control-sm"
            onChange={(event) => setHref(event.target.value)}
          />
          <Button type="submit" size="sm">
            Apply
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

function BlockToolbar({
  block,
  dragRef,
  dragProps,
}: {
  block: EmailBlock
  dragRef: (element: HTMLElement | null) => void
  dragProps: Record<string, unknown>
}) {
  const actions = useCanvasActions()
  const label = blockEntry(block).label

  return (
    <div
      role="toolbar"
      aria-label={`${label} block`}
      data-testid="block-toolbar"
      className="absolute -top-3.5 right-0 z-20 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 shadow-float"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        ref={dragRef}
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Drag ${label}`}
        data-testid="block-drag-handle"
        className="cursor-grab active:cursor-grabbing"
        {...dragProps}
      >
        <GripVerticalIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Move block up"
        data-testid="block-move-up"
        onClick={() => actions.moveBy(block.id, -1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Move block down"
        data-testid="block-move-down"
        onClick={() => actions.moveBy(block.id, 1)}
      >
        <ArrowDownIcon />
      </Button>
      {block.type === "text" || block.type === "list" ? (
        <>
          <Separator
            orientation="vertical"
            className="mx-0.5 h-4 self-center"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Bold"
            data-testid="block-bold"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runEditableCommand("bold")}
          >
            <BoldIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Italic"
            data-testid="block-italic"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runEditableCommand("italic")}
          >
            <ItalicIcon />
          </Button>
          <LinkPopover
            onApply={(href) => runEditableCommand("createLink", href)}
          />
        </>
      ) : null}
      <Separator orientation="vertical" className="mx-0.5 h-4 self-center" />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Duplicate block"
        data-testid="block-duplicate"
        onClick={() => actions.duplicate(block.id)}
      >
        <CopyIcon />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Delete block"
        data-testid="block-delete"
        onClick={() => actions.remove(block.id)}
      >
        <Trash2Icon />
      </Button>
    </div>
  )
}

function ColumnsBody({ block }: { block: ColumnsBlock }) {
  const actions = useCanvasActions()

  return (
    <div
      style={blockStyle(block, actions.theme)}
      className="flex w-full items-stretch"
      data-testid="canvas-columns"
    >
      {block.columns.map((column, index) => (
        <div
          key={column.id}
          className="min-w-0 flex-1"
          style={{
            paddingLeft: index === 0 ? 0 : block.gap / 2,
            paddingRight:
              index === block.columns.length - 1 ? 0 : block.gap / 2,
          }}
        >
          {actions.renderContainer(
            columnContainerKey(block.id, index),
            column.blocks
          )}
        </div>
      ))}
    </div>
  )
}

function BlockBody({ block }: { block: EmailBlock }) {
  const actions = useCanvasActions()
  const [slashOpen, setSlashOpen] = React.useState(false)
  const style = blockStyle(block, actions.theme)

  switch (block.type) {
    case "heading":
      return (
        <InlineEditable
          plain
          multiline={false}
          html={block.text}
          style={style}
          placeholder="Heading"
          data-editable-for={block.id}
          data-testid="block-heading-text"
          onCommit={(text) => actions.update<HeadingBlock>(block.id, { text })}
          onEnter={() =>
            actions.insertAfter(block.id, createEmailBlock("text"))
          }
          onEmptyBackspace={() => actions.remove(block.id)}
        />
      )
    case "text":
      return (
        <>
          <InlineEditable
            html={block.html}
            style={style}
            placeholder="Press '/' for commands…"
            data-editable-for={block.id}
            data-testid="block-text-body"
            onCommit={(html) => actions.update<TextBlock>(block.id, { html })}
            onEnter={() =>
              actions.insertAfter(block.id, createEmailBlock("text"))
            }
            onEmptyBackspace={() => actions.remove(block.id)}
            onSlash={() => setSlashOpen(true)}
          />
          <SlashMenu
            open={slashOpen}
            onOpenChange={setSlashOpen}
            onSelect={(item) => {
              setSlashOpen(false)
              actions.replace(block.id, item.create())
            }}
          />
        </>
      )
    case "list": {
      const List = block.ordered ? "ol" : "ul"
      return (
        <List style={style} data-testid="block-list">
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineEditable
                html={item}
                placeholder="List item"
                data-editable-for={index === 0 ? block.id : undefined}
                onCommit={(next) => {
                  const items = [...block.items]
                  items[index] = next
                  actions.update<ListBlock>(block.id, { items })
                }}
                onEnter={() => {
                  const items = [...block.items]
                  items.splice(index + 1, 0, "")
                  actions.update<ListBlock>(block.id, { items })
                }}
                onEmptyBackspace={() => {
                  if (block.items.length === 1) {
                    actions.remove(block.id)
                    return
                  }
                  actions.update<ListBlock>(block.id, {
                    items: block.items.filter((_, at) => at !== index),
                  })
                }}
              />
            </li>
          ))}
        </List>
      )
    }
    case "button":
      return (
        <div style={blockWrapperStyle(block)}>
          <span style={style}>
            <InlineEditable
              plain
              multiline={false}
              html={block.label}
              placeholder="Button"
              data-editable-for={block.id}
              data-testid="block-button-label"
              onCommit={(label) =>
                actions.update<ButtonBlock>(block.id, { label })
              }
            />
          </span>
        </div>
      )
    case "image":
      return (
        <div style={blockWrapperStyle(block)}>
          {block.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={block.src} alt={block.alt} style={style} />
          ) : (
            <span className={PAPER_HINT}>
              <ImageIcon className="size-4" />
              Add an image URL
            </span>
          )}
        </div>
      )
    case "youtube": {
      const thumbnail = youtubeThumbnail(block.video)
      return (
        <div style={blockWrapperStyle(block)}>
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt={block.alt} style={style} />
          ) : (
            <span className={PAPER_HINT}>
              <YouTubeIcon />
              Add a YouTube link
            </span>
          )}
        </div>
      )
    }
    case "divider":
      return <hr style={style} />
    case "spacer":
      return (
        <div
          style={style}
          className="rounded-[3px] bg-[repeating-linear-gradient(-45deg,#eef1f4_0_6px,transparent_6px_12px)]"
        />
      )
    case "table":
      return (
        <table style={style} data-testid="block-table">
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => {
                  const header = block.headerRow && rowIndex === 0
                  const Cell = header ? "th" : "td"
                  return (
                    <Cell
                      key={cellIndex}
                      style={{
                        border: `1px solid ${block.borderColor}`,
                        padding: "8px 10px",
                        textAlign: "left",
                        fontWeight: header ? 600 : 400,
                      }}
                    >
                      {cell}
                    </Cell>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case "code":
      return <pre style={style}>{block.code}</pre>
    case "social":
      return (
        <div style={style}>
          {block.links.map((link, index) => (
            <span key={link.id}>
              {index > 0 ? (
                <span
                  style={{ display: "inline-block", width: `${block.gap}px` }}
                />
              ) : null}
              <a
                href={link.href}
                style={{ color: style.color, textDecoration: "underline" }}
                onClick={(event) => event.preventDefault()}
              >
                {link.label}
              </a>
            </span>
          ))}
        </div>
      )
    case "footer":
      return (
        <div style={style}>
          <InlineEditable
            html={block.text}
            placeholder="Small print"
            data-editable-for={block.id}
            data-testid="block-footer-text"
            onCommit={(text) => actions.update<FooterBlock>(block.id, { text })}
          />
          <a
            href={UNSUBSCRIBE_VARIABLE}
            style={{ color: style.color, textDecoration: "underline" }}
            onClick={(event) => event.preventDefault()}
          >
            {block.unsubscribeLabel}
          </a>
        </div>
      )
    case "html":
      return block.code.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: block.code }} />
      ) : (
        <p className={PAPER_HINT}>
          Empty HTML block. Paste markup in the right panel.
        </p>
      )
    case "columns":
      return <ColumnsBody block={block} />
  }
}

export function CanvasBlock({
  block,
  container,
}: {
  block: EmailBlock
  container: ContainerKey
}) {
  const actions = useCanvasActions()
  const [hovered, setHovered] = React.useState(false)
  const selected = actions.selectedId === block.id
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id, data: { container, blockType: block.type } })

  return (
    <div
      ref={setNodeRef}
      data-testid="canvas-block"
      data-block-id={block.id}
      data-block-type={block.type}
      data-selected={selected}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(event) => {
        event.stopPropagation()
        actions.select(block.id)
      }}
    >
      <div
        className="rounded-[3px]"
        style={{
          boxShadow: selected
            ? SELECTED_RING
            : hovered
              ? HOVER_RING
              : undefined,
        }}
      >
        <BlockBody block={block} />
      </div>
      {selected || hovered ? (
        <BlockToolbar
          block={block}
          dragRef={setActivatorNodeRef}
          dragProps={{ ...attributes, ...listeners }}
        />
      ) : null}
    </div>
  )
}
