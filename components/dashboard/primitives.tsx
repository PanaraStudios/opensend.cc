"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { DateRange } from "react-day-picker"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  SearchIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { toast } from "@/components/ui/toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { cn } from "@/lib/utils"
import {
  AUTOMATION_STATUS_TONE,
  BROADCAST_STATUS_TONE,
  DOMAIN_STATUS_TONE,
  EMAIL_STATUS_TONE,
  EXPORT_STATUS_TONE,
  TEMPLATE_STATUS_TONE,
  automationStatusLabel,
  broadcastStatusLabel,
  emailStatusLabel,
  exportStatusLabel,
  statusLabel,
  templateStatusLabel,
  type BadgeTone,
} from "@/lib/dashboard/format"
import { tabActive, type SectionTabs } from "@/lib/dashboard/nav"
import type {
  AutomationStatus,
  BroadcastStatus,
  DomainStatus,
  EmailStatus,
  ExportStatus,
  TemplateStatus,
} from "@/lib/dashboard/types"

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="title-gradient text-h3">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-small text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** Page header plus route tabs. Used by Emails, Audience, and Settings.
    Tabs are real links so modifier clicks and prefetch keep working. */
export function SectionChrome({
  title,
  tabs,
  actions,
  children,
}: {
  title: string
  tabs: SectionTabs
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  const value =
    tabs.find((tab) => tabActive(pathname, tab.href))?.href ?? tabs[0].href

  return (
    <>
      <PageHeader title={title}>{actions}</PageHeader>
      <Tabs value={value}>
        <TabsList className="max-w-full [scrollbar-width:none] flex-nowrap overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.href}
              value={tab.href}
              nativeButton={false}
              render={<Link href={tab.href} />}
            >
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </>
  )
}

/** Local draft for a store-backed text field. Commits on blur so typing does
    not write localStorage and re-render every consumer per keystroke. */
export function useDraft(
  value: string,
  commit: (next: string) => void,
  onChange?: () => void
) {
  const [draft, setDraft] = React.useState(value)
  const [synced, setSynced] = React.useState(value)
  if (synced !== value) {
    setSynced(value)
    setDraft(value)
  }
  return {
    value: draft,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      setDraft(event.target.value)
      onChange?.()
    },
    onBlur: () => {
      if (draft !== value) commit(draft)
    },
  }
}

/** Delete a record from its detail page without flashing "not found" while
    the navigation back to the list is still in flight. */
export function useDeleteRecord(listHref: string) {
  const router = useRouter()
  const [leaving, setLeaving] = React.useState(false)
  return {
    leaving,
    deleteAndLeave(remove: () => void) {
      setLeaving(true)
      router.push(listHref)
      remove()
    },
  }
}

/** Back link, optional icon tile, title, badge, description, and actions.
    One header for every record detail page. */
export function DetailHeader({
  backHref,
  backLabel,
  title,
  icon: Icon,
  description,
  badge,
  actions,
}: {
  backHref: string
  backLabel: string
  title: string
  icon?: LucideIcon
  description?: string
  badge?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        className="-ml-2 w-fit text-muted-foreground"
        render={<Link href={backHref} />}
      >
        <ArrowLeftIcon data-icon="inline-start" />
        {backLabel}
      </Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span className="icon-tile">
              <Icon />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="title-gradient text-h3 break-all">{title}</h1>
            {badge}
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Surface({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("frame surface-shell", className)}>
      <div className="panel space-y-5">{children}</div>
    </div>
  )
}

/** Framed panel with a tab strip on top. */
export function PanelTabs({
  value,
  onValueChange,
  tabs,
  children,
}: {
  value: string
  onValueChange: (value: string) => void
  tabs: readonly { value: string; label: string }[]
  children: React.ReactNode
}) {
  return (
    <div className="frame">
      <div className="panel overflow-hidden p-0">
        <Tabs
          value={value}
          onValueChange={(next) => {
            if (next) onValueChange(next)
          }}
          className="gap-0"
        >
          <div className="[scrollbar-width:none] overflow-x-auto border-b border-border px-3 py-2.5 [&::-webkit-scrollbar]:hidden">
            <TabsList>
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {children}
        </Tabs>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- tables */

export function ResourceTable({
  children,
  headers,
  className,
}: {
  headers: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("frame", className)}>
      <div className="panel overflow-hidden p-0">
        <Table>
          <TableHeader>
            <TableRow>{headers}</TableRow>
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
    </div>
  )
}

export function Th({
  children,
  className,
}: {
  children?: React.ReactNode
  className?: string
}) {
  return <TableHead className={className}>{children}</TableHead>
}

/* ----------------------------------------------------------- empty states */

export function EmptyState({
  icon: Icon,
  title,
  description,
  size = "default",
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  /** `sm` sits inside another panel, so it drops the frame. */
  size?: "default" | "sm"
  children?: React.ReactNode
}) {
  const body = (
    <Empty
      className={
        size === "sm" ? "min-h-40 py-8" : "panel min-h-72 border-0 py-10"
      }
    >
      <EmptyHeader>
        <EmptyMedia variant="icon" className="icon-tile border-0 shadow-none">
          <Icon className="size-4" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
    </Empty>
  )
  return size === "sm" ? body : <div className="frame">{body}</div>
}

/** "X not found" with a way back to the list. */
export function NotFoundState({
  icon,
  noun,
  backHref,
  backLabel = `Back to ${noun}s`,
  description = "It may have been deleted from this workspace.",
}: {
  icon: LucideIcon
  noun: string
  backHref: string
  backLabel?: string
  description?: string
}) {
  const capitalized = noun.charAt(0).toUpperCase() + noun.slice(1)
  return (
    <EmptyState
      icon={icon}
      title={`${capitalized} not found`}
      description={description}
    >
      <Button nativeButton={false} render={<Link href={backHref} />}>
        {backLabel}
      </Button>
    </EmptyState>
  )
}

/* ----------------------------------------------------------------- badges */

function badgeDotClassName(tone: BadgeTone): string {
  switch (tone) {
    case "success":
      return "bg-success"
    case "destructive":
      return "bg-destructive"
    case "warning":
      return "bg-warning"
    case "secondary":
      return "bg-muted-foreground"
    case "outline":
      return "bg-foreground"
  }
}

export function emailStatusDotClassName(status: EmailStatus): string {
  return badgeDotClassName(EMAIL_STATUS_TONE[status])
}

export function broadcastStatusDotClassName(status: BroadcastStatus): string {
  return badgeDotClassName(BROADCAST_STATUS_TONE[status])
}

function ToneBadge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <Badge variant={tone} dot>
      {label}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: DomainStatus }) {
  return (
    <ToneBadge tone={DOMAIN_STATUS_TONE[status]} label={statusLabel(status)} />
  )
}

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  return (
    <ToneBadge
      tone={EMAIL_STATUS_TONE[status]}
      label={emailStatusLabel(status)}
    />
  )
}

export function BroadcastStatusBadge({ status }: { status: BroadcastStatus }) {
  return (
    <ToneBadge
      tone={BROADCAST_STATUS_TONE[status]}
      label={broadcastStatusLabel(status)}
    />
  )
}

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  return (
    <ToneBadge
      tone={TEMPLATE_STATUS_TONE[status]}
      label={templateStatusLabel(status)}
    />
  )
}

export function AutomationStatusBadge({
  status,
}: {
  status: AutomationStatus
}) {
  return (
    <ToneBadge
      tone={AUTOMATION_STATUS_TONE[status]}
      label={automationStatusLabel(status)}
    />
  )
}

export function ExportStatusBadge({ status }: { status: ExportStatus }) {
  return (
    <ToneBadge
      tone={EXPORT_STATUS_TONE[status]}
      label={exportStatusLabel(status)}
    />
  )
}

/* -------------------------------------------------------------- clipboard */

export async function copyToClipboard(value: string, label = "Copy") {
  await navigator.clipboard.writeText(value)
  toast.add({ type: "success", title: `${label} copied` })
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  async function copy() {
    await copyToClipboard(value, label)
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export function MonoValue({
  children,
  copyValue,
}: {
  children: React.ReactNode
  copyValue?: string
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <code className="truncate font-mono text-[13px]">{children}</code>
      {copyValue ? <CopyButton value={copyValue} /> : null}
    </span>
  )
}

/* ------------------------------------------------------------------ menus */

export function MoreMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="More options"
            className="text-muted-foreground"
          />
        }
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Floating bulk-action bar, pinned to the bottom of the content column while rows are selected. */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number
  onClear: () => void
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="pointer-events-none sticky bottom-6 z-40 order-last mt-auto flex h-0 items-end justify-center">
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="pointer-events-auto flex animate-in items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-lifted duration-200 fade-in slide-in-from-bottom-2"
      >
        <p className="px-2.5 text-sm font-medium tabular-nums">
          {count} selected
        </p>
        <Separator orientation="vertical" className="h-5 self-center" />
        {children}
        <Separator orientation="vertical" className="h-5 self-center" />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear selection"
          onClick={onClear}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/* ---------------------------------------------------------------- selects */

export type SelectOption = {
  value: string
  label: string
  dotClassName?: string
}

/** Single-value select driven by an options array. Renders the items once,
    for both the trigger value and the list. */
export function OptionSelect({
  value,
  defaultValue,
  onChange,
  items,
  id,
  name,
  size = "default",
  align = "start",
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  items: readonly SelectOption[]
  id?: string
  name?: string
  size?: "sm" | "default"
  align?: "start" | "center" | "end"
  className?: string
  disabled?: boolean
  "aria-label"?: string
}) {
  return (
    <Select
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (next && onChange) onChange(next)
      }}
      items={[...items]}
      name={name}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={className}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align={align} alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.dotClassName ? (
                <span className="inline-flex items-center gap-2 leading-none">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      item.dotClassName
                    )}
                  />
                  <span>{item.label}</span>
                </span>
              ) : (
                item.label
              )}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

/* ---------------------------------------------------------------- toolbar */

export type ToolbarFilter = {
  value: string
  onChange: (value: string) => void
  items: readonly SelectOption[]
  "aria-label": string
}

/** Search, optional date range, any number of filter selects, optional
    export. One toolbar for every list view. */
export function ListToolbar({
  query,
  onQueryChange,
  placeholder,
  range,
  onRangeChange,
  allowAllTime = true,
  filters = [],
  onExport,
  children,
}: {
  query: string
  onQueryChange: (value: string) => void
  placeholder: string
  range?: DateRange | undefined
  onRangeChange?: (range: DateRange | undefined) => void
  allowAllTime?: boolean
  filters?: readonly ToolbarFilter[]
  onExport?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="h-8! w-full max-w-full overflow-hidden sm:max-w-xs">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          className="h-full! min-w-0"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
        />
      </InputGroup>
      {onRangeChange ? (
        <DateRangePicker
          range={range}
          onRangeChange={onRangeChange}
          allowAllTime={allowAllTime}
        />
      ) : null}
      {filters.map((filter) => (
        <OptionSelect
          key={filter["aria-label"]}
          size="sm"
          align="end"
          value={filter.value}
          onChange={filter.onChange}
          items={filter.items}
          aria-label={filter["aria-label"]}
        />
      ))}
      {children}
      {onExport ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Export"
          className="ml-auto"
          onClick={onExport}
        >
          <DownloadIcon />
        </Button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------- docs */

export function DocsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick}>
      <BookOpenIcon data-icon="inline-start" />
      Docs
    </Button>
  )
}

export type DocsSection = { title: string; body: React.ReactNode }

export function DocsSheet({
  open,
  onOpenChange,
  title,
  description,
  sections,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  sections: readonly DocsSection[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-1">
              <p className="font-medium">{section.title}</p>
              {typeof section.body === "string" ? (
                <p className="text-muted-foreground">{section.body}</p>
              ) : (
                section.body
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
