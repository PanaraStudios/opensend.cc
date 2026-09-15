"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import { endOfDay, format, isSameDay, startOfDay, subDays } from "date-fns"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { PageHeader } from "@/components/dashboard/primitives"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CalendarDate, Download, Search } from "@/components/dashboard/icons"
import { DEMO_NOW } from "@/lib/dashboard/data"
import { EMAIL_TABS, tabActive } from "@/lib/dashboard/nav"
import type { SuppressionReason } from "@/lib/dashboard/types"

export const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "15d", label: "Last 15 days" },
  { value: "30d", label: "Last 30 days" },
] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"] | "all"

export const STATUS_ITEMS = [
  { value: "all", label: "All statuses" },
  { value: "delivered", label: "Delivered" },
  { value: "opened", label: "Opened" },
  { value: "clicked", label: "Clicked" },
  { value: "sent", label: "Sent" },
  { value: "scheduled", label: "Scheduled" },
  { value: "bounced", label: "Bounced" },
  { value: "failed", label: "Failed" },
  { value: "canceled", label: "Canceled" },
  { value: "suppressed", label: "Suppressed" },
] as const

export const ORIGIN_ITEMS = [
  { value: "all", label: "All origins" },
  { value: "bounced", label: "Hard bounce" },
  { value: "complained", label: "Complaint" },
  { value: "manual", label: "Manual" },
] as const

export const REASON_ITEMS = [
  { value: "manual", label: "Manual" },
  { value: "bounced", label: "Hard bounce" },
  { value: "complained", label: "Complaint" },
] as const

export type SelectOption = { value: string; label: string }

export function defaultEmailRange(): DateRange {
  return rangeFromPreset("15d") ?? { from: new Date(DEMO_NOW) }
}

export function rangeFromPreset(
  preset: RangePreset,
  now = DEMO_NOW
): DateRange | undefined {
  const current = new Date(now)
  switch (preset) {
    case "today":
      return { from: startOfDay(current), to: endOfDay(current) }
    case "yesterday": {
      const yesterday = subDays(current, 1)
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) }
    }
    case "7d":
      return { from: startOfDay(subDays(current, 6)), to: endOfDay(current) }
    case "15d":
      return { from: startOfDay(subDays(current, 14)), to: endOfDay(current) }
    case "30d":
      return { from: startOfDay(subDays(current, 29)), to: endOfDay(current) }
    case "all":
      return undefined
  }
}

export function presetFromRange(range: DateRange | undefined): RangePreset | "custom" {
  if (!range?.from) return "all"
  const presets: RangePreset[] = ["today", "yesterday", "7d", "15d", "30d"]
  for (const preset of presets) {
    const candidate = rangeFromPreset(preset)
    if (
      candidate?.from &&
      isSameDay(candidate.from, range.from) &&
      (!range.to || !candidate.to || isSameDay(range.to, candidate.to))
    ) {
      return preset
    }
  }
  return "custom"
}

export function rangeLabel(
  range: DateRange | undefined,
  allowAllTime = false
): string {
  const preset = presetFromRange(range)
  if (preset === "all") return allowAllTime ? "All time" : "Date range"
  if (preset !== "custom") {
    return RANGE_PRESETS.find((item) => item.value === preset)?.label ?? "Date range"
  }
  if (!range?.from) return "Date range"
  if (!range.to) return format(range.from, "MMM d, yyyy")
  return `${format(range.from, "MMM d")} - ${format(range.to, "MMM d, yyyy")}`
}

export function inDateRange(
  timestamp: number,
  range: DateRange | undefined
): boolean {
  if (!range?.from) return true
  const start = startOfDay(range.from).getTime()
  const end = endOfDay(range.to ?? range.from).getTime()
  return timestamp >= start && timestamp <= end
}

export function filterEmailHaystack(
  query: string,
  fields: { to?: string; from?: string; subject?: string }
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [fields.to, fields.from, fields.subject].some((field) =>
    field?.toLowerCase().includes(needle)
  )
}

export function isSuppressionReason(value: string): value is SuppressionReason {
  return value === "manual" || value === "bounced" || value === "complained"
}

export function EmailsChrome({
  actions,
  children,
}: {
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const value =
    EMAIL_TABS.find((tab) => tabActive(pathname, tab.href))?.href ??
    EMAIL_TABS[0].href

  return (
    <>
      <PageHeader title="Emails">{actions}</PageHeader>
      <Tabs
        value={value}
        onValueChange={(next) => {
          if (next) router.push(next)
        }}
      >
        <TabsList>
          {EMAIL_TABS.map((tab) => (
            <TabsTrigger key={tab.href} value={tab.href}>
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </>
  )
}

export function DateRangePicker({
  range,
  onRangeChange,
  allowAllTime = false,
}: {
  range: DateRange | undefined
  onRangeChange: (range: DateRange | undefined) => void
  allowAllTime?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const active = presetFromRange(range)
  const presets = allowAllTime
    ? ([{ value: "all", label: "All time" }, ...RANGE_PRESETS] as const)
    : RANGE_PRESETS

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className="h-8" />}
      >
        <CalendarDate data-icon="inline-start" />
        {rangeLabel(range, allowAllTime)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {presets.map((preset) => (
              <Button
                key={preset.value}
                type="button"
                size="xs"
                variant={active === preset.value ? "default" : "outline"}
                onClick={() => {
                  onRangeChange(rangeFromPreset(preset.value))
                  setOpen(false)
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            selected={range}
            onSelect={(next) => {
              if (!next?.from) {
                onRangeChange(allowAllTime ? undefined : defaultEmailRange())
                return
              }
              onRangeChange(next)
              if (next.to) setOpen(false)
            }}
            defaultMonth={range?.to ?? range?.from ?? new Date(DEMO_NOW)}
            autoFocus
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ToolbarSelect({
  value,
  onChange,
  items,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  items: readonly SelectOption[]
  "aria-label": string
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next)
      }}
      items={[...items]}
    >
      <SelectTrigger size="sm" aria-label={ariaLabel} className="h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function EmailsToolbar({
  query,
  onQueryChange,
  placeholder,
  range,
  onRangeChange,
  allowAllTime,
  select,
  onExport,
}: {
  query: string
  onQueryChange: (value: string) => void
  placeholder: string
  range: DateRange | undefined
  onRangeChange: (range: DateRange | undefined) => void
  allowAllTime?: boolean
  select?: {
    value: string
    onChange: (value: string) => void
    items: readonly SelectOption[]
    "aria-label": string
  }
  onExport?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="h-8! w-full max-w-xs min-w-0 overflow-hidden">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          className="h-full! min-w-0 overflow-hidden"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
        />
      </InputGroup>
      <DateRangePicker
        range={range}
        onRangeChange={onRangeChange}
        allowAllTime={allowAllTime}
      />
      {select ? (
        <ToolbarSelect
          value={select.value}
          onChange={select.onChange}
          items={select.items}
          aria-label={select["aria-label"]}
        />
      ) : null}
      {onExport ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Export"
          className="ml-auto"
          onClick={onExport}
        >
          <Download />
        </Button>
      ) : null}
    </div>
  )
}
