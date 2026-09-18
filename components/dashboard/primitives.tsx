"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import type { DateRange } from "react-day-picker"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { cn } from "@/lib/utils"
import { DEMO_NOW } from "@/lib/dashboard/data"
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
  formatDateTime,
  formatRelative,
  pluralize,
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

/** Local draft of a stored string: edits stay here until `commitDraft`, and
    a change to the stored value from elsewhere replaces the draft. For
    controls that report a value; `useDraft` wraps it for plain inputs. */
export function useDraftValue(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = React.useState(value)
  const [synced, setSynced] = React.useState(value)
  if (synced !== value) {
    setSynced(value)
    setDraft(value)
  }
  return {
    draft,
    setDraft,
    commitDraft: () => {
      if (draft !== value) commit(draft)
    },
  }
}

/** Local draft for a store-backed text field. Commits on blur so typing does
    not write localStorage and re-render every consumer per keystroke. */
export function useDraft(
  value: string,
  commit: (next: string) => void,
  onChange?: () => void
) {
  const { draft, setDraft, commitDraft } = useDraftValue(value, commit)
  return {
    value: draft,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      setDraft(event.target.value)
      onChange?.()
    },
    onBlur: commitDraft,
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

/** Labelled facts under a detail header. Values are phrasing content, so
    badges and copy buttons can sit beside the text. */
export function MetaStrip({
  items,
}: {
  items: readonly { label: string; value: React.ReactNode }[]
}) {
  return (
    <ItemGroup className="flex-row flex-wrap gap-2">
      {items.map((item) => (
        <Item key={item.label} size="sm" className="w-fit min-w-40 flex-1">
          <ItemContent>
            <ItemTitle>{item.label}</ItemTitle>
            <ItemDescription className="flex min-w-0 items-center gap-1.5">
              {item.value}
            </ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
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

export type EventTrailStep = {
  id: string
  icon: LucideIcon
  label: string
  /** When it happened. A step without one is still ahead, and reads dimmed. */
  caption?: string
}

/** Horizontal run of milestones: icon, label, and when each was reached.
    Shared by the email event row and the domain event trail. */
export function EventTrail({
  steps,
  className,
}: {
  steps: readonly EventTrailStep[]
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {steps.map((step, index) => {
        const Icon = step.icon
        return (
          <React.Fragment key={step.id}>
            {index > 0 ? (
              <Separator orientation="vertical" className="h-8 self-center" />
            ) : null}
            <Item
              size="xs"
              className={cn("w-fit", step.caption ? undefined : "opacity-50")}
            >
              <ItemMedia variant="icon">
                <Icon />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{step.label}</ItemTitle>
                {step.caption ? (
                  <ItemDescription>{step.caption}</ItemDescription>
                ) : null}
              </ItemContent>
            </Item>
          </React.Fragment>
        )
      })}
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

/* ------------------------------------------------------------- pagination */

export const PAGE_SIZES = [40, 80, 120] as const

/** Client-side paging over an already filtered list. The page clamps, so a
    filter that shrinks the list never strands the view past the last page. */
export function usePagination<T>(rows: readonly T[]) {
  const [pageSize, setPageSize] = React.useState<number>(PAGE_SIZES[0])
  const [requested, setPage] = React.useState(0)
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(requested, pageCount - 1)
  return {
    pageRows: rows.slice(page * pageSize, (page + 1) * pageSize),
    pagination: {
      page,
      pageCount,
      pageSize,
      total: rows.length,
      onPageChange: setPage,
      onPageSizeChange(next: number) {
        setPageSize(next)
        setPage(0)
      },
    },
  }
}

/** Footer for a paged list: position, page size, and the two step buttons. */
export function ListPagination({
  page,
  pageCount,
  pageSize,
  total,
  noun,
  onPageChange,
  onPageSizeChange,
  previousLabel = "Previous",
  nextLabel = "Next",
}: ReturnType<typeof usePagination>["pagination"] & {
  noun: string
  previousLabel?: string
  nextLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1 text-caption text-muted-foreground tabular-nums">
        <span>
          Page {page + 1} of {pageCount} · {pluralize(total, noun)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label="Items per page"
                className="text-muted-foreground"
              />
            }
          >
            {pageSize} items
            <ChevronsUpDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top">
            <DropdownMenuRadioGroup
              value={String(pageSize)}
              onValueChange={(next) => onPageSizeChange(Number(next))}
            >
              {PAGE_SIZES.map((size) => (
                <DropdownMenuRadioItem key={size} value={String(size)}>
                  {size} items
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          {previousLabel}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        >
          {nextLabel}
        </Button>
      </div>
    </div>
  )
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

/** The same tone as a CSS color, for chart strokes and fills. */
function badgeToneColor(tone: BadgeTone): string {
  switch (tone) {
    case "success":
      return "var(--success)"
    case "destructive":
      return "var(--destructive)"
    case "warning":
      return "var(--warning)"
    case "secondary":
      return "var(--muted-foreground)"
    case "outline":
      return "var(--foreground)"
  }
}

export function emailStatusColor(status: EmailStatus): string {
  return badgeToneColor(EMAIL_STATUS_TONE[status])
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

/** Monospace well for source and payloads, with an optional copy button
    pinned to the corner. */
export function CodeWell({
  children,
  copyValue,
  className,
}: {
  children: React.ReactNode
  copyValue?: string
  className?: string
}) {
  return (
    <div className="relative">
      <pre
        className={cn(
          "overflow-x-auto rounded-lg bg-muted/50 p-4 font-mono text-mono whitespace-pre-wrap",
          copyValue && "pr-12",
          className
        )}
      >
        {children}
      </pre>
      {copyValue ? (
        <div className="absolute top-3 right-3">
          <CopyButton value={copyValue} />
        </div>
      ) : null}
    </div>
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

/** Optional date range plus any number of filter selects. ListToolbar renders
    these after its search box; pages without search use them on their own. */
export function ToolbarFilters({
  range,
  onRangeChange,
  allowAllTime = true,
  filters = [],
}: {
  range?: DateRange | undefined
  onRangeChange?: (range: DateRange | undefined) => void
  allowAllTime?: boolean
  filters?: readonly ToolbarFilter[]
}) {
  return (
    <>
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
    </>
  )
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
      <ToolbarFilters
        range={range}
        onRangeChange={onRangeChange}
        allowAllTime={allowAllTime}
        filters={filters}
      />
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

/* ------------------------------------------------------------------- time */

/** Age against the demo clock, the one the date range picker uses, so
    "Last 15 days" and "15d ago" agree. The exact time sits in the tooltip.
    `at` may be null for records that never happened, e.g. an unused key. */
export function RelativeTime({
  at,
  fallback = "—",
}: {
  at: number | null
  fallback?: string
}) {
  if (at === null) return <>{fallback}</>
  return (
    <time dateTime={new Date(at).toISOString()} title={formatDateTime(at)}>
      {formatRelative(at, DEMO_NOW)}
    </time>
  )
}

/* ----------------------------------------------------------------- hints */

/** Info icon that explains the label beside it on hover or focus. */
export function InfoTip({
  children,
  label = "More information",
}: {
  children: React.ReactNode
  label?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
          />
        }
      >
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent className="flex flex-col items-start gap-1.5 text-left">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

/* --------------------------------------------------------------- secrets */

/** Read-only secret behind dots, with a reveal toggle and a copy button.
    One field for every token or signing secret the dashboard shows once. */
export function SecretField({
  value,
  label = "Secret",
  id,
}: {
  value: string
  label?: string
  id?: string
}) {
  const [revealed, setRevealed] = React.useState(false)
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        readOnly
        aria-label={label}
        value={revealed ? value : "•".repeat(value.length)}
        className="font-mono text-[13px]"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
        <CopyButton value={value} label={label} />
      </InputGroupAddon>
    </InputGroup>
  )
}
