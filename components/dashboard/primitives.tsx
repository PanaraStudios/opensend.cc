"use client"

import * as React from "react"
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
import { statusLabel } from "@/lib/dashboard/format"
import type { DomainStatus } from "@/lib/dashboard/types"
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
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
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
}: {
  headers: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <Table>
        <TableHeader>
          <TableRow>{headers}</TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
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
    <Empty className="min-h-72 border border-dashed border-border bg-surface/50">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="size-4" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children ? <EmptyContent>{children}</EmptyContent> : null}
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
