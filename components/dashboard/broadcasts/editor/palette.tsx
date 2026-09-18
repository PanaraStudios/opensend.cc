"use client"

import * as React from "react"
import Link from "next/link"
import { useDndMonitor, useDraggable } from "@dnd-kit/core"
import { GripVerticalIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  PALETTE_MENUS,
  type PaletteItem,
  type PaletteMenu,
} from "@/components/dashboard/broadcasts/editor/blocks"
import {
  availableVariables,
  formatVariable,
  type EmailVariable,
} from "@/lib/dashboard/email-document"
import { useDashboard } from "@/lib/dashboard/store"
import { cn } from "@/lib/utils"

/* The floating insert rail. Each button opens a flyout of rows that are both
   clickable and draggable, so a block can be dropped at a spot on the canvas
   or simply appended with a click. */

const ROW_CLASS =
  "flex w-full cursor-grab items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none select-none hover:bg-muted focus-visible:bg-muted active:cursor-grabbing [&_svg:not([class*='size-'])]:size-4"

function DragRow({
  id,
  data,
  label,
  hint,
  testId,
  onClick,
  children,
}: {
  id: string
  data: Record<string, unknown>
  label: string
  hint?: string
  testId: string
  onClick: () => void
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data,
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={hint}
      data-testid={testId}
      className={cn(ROW_CLASS, isDragging && "opacity-50")}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <GripVerticalIcon className="size-3.5 shrink-0 text-faint-foreground" />
      {children}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function BlockMenu({
  menu,
  open,
  onOpenChange,
  onInsert,
}: {
  menu: PaletteMenu
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (item: PaletteItem) => void
}) {
  const Icon = menu.icon

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={menu.label}
            data-testid={`insert-${menu.id}`}
          />
        }
      >
        <Icon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-56 gap-0.5 p-1"
        data-testid={`palette-menu-${menu.id}`}
      >
        {menu.items.map((item) => {
          const ItemIcon = item.icon
          return (
            <DragRow
              key={item.id}
              id={`palette:${item.id}`}
              data={{ paletteId: item.id }}
              label={item.label}
              hint={item.description}
              testId={`palette-${item.id}`}
              onClick={() => onInsert(item)}
            >
              <ItemIcon className="size-4 shrink-0 text-muted-foreground" />
            </DragRow>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

function VariableMenu({
  menu,
  open,
  onOpenChange,
  onInsert,
}: {
  menu: PaletteMenu
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (variable: EmailVariable) => void
}) {
  const { state } = useDashboard()
  const Icon = menu.icon
  const variables = React.useMemo(
    () => availableVariables(state.properties),
    [state.properties]
  )
  const groups = [
    {
      key: "contact" as const,
      label: "Contact properties",
      items: variables.filter((item) => item.group === "contact"),
    },
    {
      key: "system" as const,
      label: "System",
      items: variables.filter((item) => item.group === "system"),
    },
  ]

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Variables"
            data-testid="insert-variables"
          />
        }
      >
        <Icon className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-64 gap-0.5 p-1"
        data-testid="palette-menu-variables"
      >
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <React.Fragment key={group.key}>
              <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((variable) => (
                <DragRow
                  key={variable.name}
                  id={`variable:${variable.name}`}
                  data={{
                    variable: variable.name,
                    fallback: variable.fallback,
                  }}
                  label={variable.label}
                  hint={formatVariable(variable.name, variable.fallback)}
                  testId={`palette-variable-${variable.name}`}
                  onClick={() => onInsert(variable)}
                >
                  <code className="shrink-0 font-mono text-[11px] text-faint-foreground">
                    {"{x}"}
                  </code>
                </DragRow>
              ))}
            </React.Fragment>
          )
        )}
        <Separator className="my-1" />
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="w-full justify-start"
          data-testid="palette-create-property"
          render={<Link href="/properties" target="_blank" rel="noreferrer" />}
        >
          <PlusIcon data-icon="inline-start" />
          Create property
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export function InsertRail({
  onInsertBlock,
  onInsertVariable,
  className,
}: {
  onInsertBlock: (item: PaletteItem) => void
  onInsertVariable: (variable: EmailVariable) => void
  className?: string
}) {
  const [openMenu, setOpenMenu] = React.useState<string | null>(null)
  /* The flyout stays mounted for the whole drag — closing it would unmount
     the row being dragged — and closes once the block has landed. */
  useDndMonitor({
    onDragEnd: () => setOpenMenu(null),
    onDragCancel: () => setOpenMenu(null),
  })

  return (
    <div
      role="toolbar"
      aria-label="Insert"
      data-testid="insert-rail"
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-float",
        className
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {PALETTE_MENUS.map((menu) =>
        menu.id === "variables" ? (
          <VariableMenu
            key={menu.id}
            menu={menu}
            open={openMenu === menu.id}
            onOpenChange={(next) => setOpenMenu(next ? menu.id : null)}
            onInsert={onInsertVariable}
          />
        ) : (
          <BlockMenu
            key={menu.id}
            menu={menu}
            open={openMenu === menu.id}
            onOpenChange={(next) => setOpenMenu(next ? menu.id : null)}
            onInsert={onInsertBlock}
          />
        )
      )}
    </div>
  )
}
