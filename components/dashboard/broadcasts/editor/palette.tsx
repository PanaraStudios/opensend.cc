"use client"

import * as React from "react"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

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
} from "@/lib/dashboard/email-variables"
import { useDashboard } from "@/lib/dashboard/store"
import { cn } from "@/lib/utils"

/* The floating insert rail. Each button opens a flyout of rows, and a row
   inserts at the caret. */

const ROW_CLASS =
  "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none select-none hover:bg-muted focus-visible:bg-muted [&_svg:not([class*='size-'])]:size-4"

function InsertRow({
  label,
  hint,
  testId,
  onClick,
  children,
}: {
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
      className={ROW_CLASS}
      onClick={onClick}
    >
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
            <InsertRow
              key={item.id}
              label={item.label}
              hint={item.description}
              testId={`palette-${item.id}`}
              onClick={() => onInsert(item)}
            >
              <ItemIcon className="size-4 shrink-0 text-muted-foreground" />
            </InsertRow>
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
            onInsert={(variable) => {
              setOpenMenu(null)
              onInsertVariable(variable)
            }}
          />
        ) : (
          <BlockMenu
            key={menu.id}
            menu={menu}
            open={openMenu === menu.id}
            onOpenChange={(next) => setOpenMenu(next ? menu.id : null)}
            onInsert={(item) => {
              setOpenMenu(null)
              onInsertBlock(item)
            }}
          />
        )
      )}
    </div>
  )
}
