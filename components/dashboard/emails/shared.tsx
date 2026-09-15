"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
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
import {
  RANGE_PRESETS,
  rangeAfterCalendarClear,
  rangeFromPreset,
  rangeLabel,
  presetFromRange,
  shouldCloseDateRangePicker,
} from "@/lib/dashboard/email-range"
import { EMAIL_TABS, tabActive } from "@/lib/dashboard/nav"
import type { SuppressionReason } from "@/lib/dashboard/types"

export {
  RANGE_PRESETS,
  defaultEmailRange,
  inDateRange,
  rangeFromPreset,
  rangeLabel,
  presetFromRange,
  type RangePreset,
} from "@/lib/dashboard/email-range"

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
      <PopoverTrigger render={<Button variant="outline" className="h-8" />}>
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
                onRangeChange(rangeAfterCalendarClear(allowAllTime))
                return
              }
              onRangeChange(next)
              if (shouldCloseDateRangePicker(next)) setOpen(false)
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
      <InputGroup className="h-8! max-w-xs overflow-hidden">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          className="h-full! min-w-0"
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
