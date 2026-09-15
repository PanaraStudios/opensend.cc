"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { SearchIcon } from "lucide-react"

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
  DropdownMenuItem,
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
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  automationStatusLabel,
  broadcastStatusLabel,
  emailStatusLabel,
  exportStatusLabel,
  statusLabel,
  templateStatusLabel,
} from "@/lib/dashboard/format"
import { tabActive } from "@/lib/dashboard/nav"
import type {
  AutomationStatus,
  BroadcastStatus,
  DomainStatus,
  EmailStatus,
  ExportStatus,
  TemplateStatus,
} from "@/lib/dashboard/types"
import { CheckIcon, CopyIcon, MoreHorizontalIcon } from "lucide-react"

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

export function SectionTabs({
  items,
  label = "Section",
  className,
}: {
  items: readonly { href: string; title: string }[]
  label?: string
  className?: string
}) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={label}
      className={cn(
        "inline-flex w-fit flex-wrap items-center gap-1 rounded-full border border-border bg-secondary p-1",
        className
      )}
    >
      {items.map((item) => {
        const active = tabActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "inline-flex h-8 items-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {item.title}
          </Link>
        )
      })}
    </nav>
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

export function SearchField({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  className?: string
}) {
  return (
    <div className={cn("relative w-full max-w-xs", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-8 pl-8"
      />
    </div>
  )
}

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

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <Empty className="frame min-h-72">
      <div className="panel flex w-full flex-col items-center gap-3 py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="icon-tile border-0 shadow-none">
            <Icon className="size-4" />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {children ? <EmptyContent>{children}</EmptyContent> : null}
      </div>
    </Empty>
  )
}

export function StatusBadge({ status }: { status: DomainStatus }) {
  const variant =
    status === "verified"
      ? "success"
      : status === "pending" || status === "temporary_failure"
        ? "warning"
        : status === "failed"
          ? "destructive"
          : "secondary"

  return (
    <Badge variant={variant} dot>
      {statusLabel(status)}
    </Badge>
  )
}

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  const variant =
    status === "delivered" || status === "opened" || status === "clicked"
      ? "success"
      : status === "bounced" || status === "failed" || status === "complained"
        ? "destructive"
        : status === "scheduled" || status === "queued" || status === "delivery_delayed"
          ? "warning"
          : status === "canceled" || status === "suppressed"
            ? "secondary"
            : "outline"

  return (
    <Badge variant={variant} dot>
      {emailStatusLabel(status)}
    </Badge>
  )
}

export function BroadcastStatusBadge({ status }: { status: BroadcastStatus }) {
  const variant =
    status === "sent"
      ? "success"
      : status === "scheduled" || status === "queued"
        ? "warning"
        : status === "canceled"
          ? "secondary"
          : "outline"

  return (
    <Badge variant={variant} dot>
      {broadcastStatusLabel(status)}
    </Badge>
  )
}

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  return (
    <Badge variant={status === "published" ? "success" : "secondary"} dot>
      {templateStatusLabel(status)}
    </Badge>
  )
}

export function AutomationStatusBadge({ status }: { status: AutomationStatus }) {
  return (
    <Badge variant={status === "enabled" ? "success" : "secondary"} dot>
      {automationStatusLabel(status)}
    </Badge>
  )
}

export function ExportStatusBadge({ status }: { status: ExportStatus }) {
  const variant =
    status === "ready" ? "success" : status === "processing" ? "warning" : "secondary"
  return (
    <Badge variant={variant} dot>
      {exportStatusLabel(status)}
    </Badge>
  )
}

export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string
  label?: string
}) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    toast.add({ type: "success", title: `${label} copied` })
    window.setTimeout(() => setCopied(false), 1500)
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

export function MoreMenu({
  children,
}: {
  children: React.ReactNode
}) {
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
      <DropdownMenuContent align="end" className="min-w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { DropdownMenuItem as MoreMenuItem }

export function ConfirmDelete({
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

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 rounded-lg border border-input bg-background px-2 text-[13px] text-foreground dark:bg-surface"
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>
}
