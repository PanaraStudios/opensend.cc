"use client"

import * as React from "react"
import Link from "next/link"
import { EditorFocusScope } from "@react-email/editor/ui"
import { PlusIcon, VariableIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  FLOATING_SURFACE,
  MENU_ROW,
} from "@/components/dashboard/broadcasts/editor/controls"
import {
  PALETTE_DRAG_TYPE,
  PALETTE_MENUS,
  type PaletteIcon,
  type PaletteItem,
} from "@/components/dashboard/broadcasts/editor/blocks"
import {
  availableVariables,
  formatVariable,
  type EmailVariable,
} from "@/lib/dashboard/email-variables"
import { useDashboard } from "@/lib/dashboard/store"
import { cn } from "@/lib/utils"

/* The floating insert rail. Each button opens a flyout of rows, and a row
   inserts at the caret.

   The engine drops the selection when focus leaves the editor for anything it
   does not know, which is how it tells "clicked away" from "using a menu".
   The rail and its flyouts are menus, so each registers as a focus scope;
   without that, opening one would move the caret to the top of the email
   before the insert ran. */

function InsertRow({
  dragId,
  onDragEnd,
  label,
  hint,
  testId,
  onClick,
  children,
}: {
  /** Set on rows that can also be dragged to a spot on the canvas. */
  dragId?: string
  onDragEnd?: () => void
  label: string
  hint?: string
  testId: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={hint}
      data-testid={testId}
      className={cn(MENU_ROW, "hover:bg-muted focus-visible:bg-muted")}
      draggable={Boolean(dragId)}
      onDragStart={(event) => {
        if (!dragId) return
        event.dataTransfer.setData(PALETTE_DRAG_TYPE, dragId)
        event.dataTransfer.effectAllowed = "copy"
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
    >
      {children}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function RailFlyout({
  id,
  label,
  icon: Icon,
  open,
  onOpenChange,
  className,
  children,
}: {
  id: string
  label: string
  icon: PaletteIcon
  open: boolean
  onOpenChange: (open: boolean) => void
  className: string
  children: React.ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            data-testid={`insert-${id}`}
          />
        }
      >
        <Icon className="size-4" />
      </PopoverTrigger>
      <EditorFocusScope>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className={cn("gap-0.5 p-1", className)}
          data-testid={`palette-menu-${id}`}
        >
          {children}
        </PopoverContent>
      </EditorFocusScope>
    </Popover>
  )
}

function VariableRows({
  onInsert,
}: {
  onInsert: (variable: EmailVariable) => void
}) {
  const { state } = useDashboard()
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
    <>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <React.Fragment key={group.key}>
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {group.label}
            </p>
            {group.items.map((variable) => (
              <InsertRow
                key={variable.name}
                label={variable.label}
                hint={formatVariable(variable.name, variable.fallback)}
                testId={`palette-variable-${variable.name}`}
                onClick={() => onInsert(variable)}
              >
                <code className="shrink-0 font-mono text-[11px] text-faint-foreground">
                  {"{x}"}
                </code>
              </InsertRow>
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
    </>
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
  const flyout = (id: string) => ({
    id,
    open: openMenu === id,
    onOpenChange: (next: boolean) => setOpenMenu(next ? id : null),
  })

  return (
    <EditorFocusScope>
      <div
        role="toolbar"
        aria-label="Insert"
        data-testid="insert-rail"
        className={cn("flex flex-col gap-0.5", FLOATING_SURFACE, className)}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {PALETTE_MENUS.map((menu) => (
          <RailFlyout
            key={menu.id}
            {...flyout(menu.id)}
            label={menu.label}
            icon={menu.icon}
            className="w-56"
          >
            {menu.items.map((item) => {
              const ItemIcon = item.icon
              return (
                <InsertRow
                  key={item.id}
                  dragId={item.id}
                  onDragEnd={() => setOpenMenu(null)}
                  label={item.label}
                  hint={item.description}
                  testId={`palette-${item.id}`}
                  onClick={() => {
                    setOpenMenu(null)
                    onInsertBlock(item)
                  }}
                >
                  <ItemIcon className="size-4 shrink-0 text-muted-foreground" />
                </InsertRow>
              )
            })}
          </RailFlyout>
        ))}
        <RailFlyout
          {...flyout("variables")}
          label="Variables"
          icon={VariableIcon}
          className="w-64"
        >
          <VariableRows
            onInsert={(variable) => {
              setOpenMenu(null)
              onInsertVariable(variable)
            }}
          />
        </RailFlyout>
      </div>
    </EditorFocusScope>
  )
}
