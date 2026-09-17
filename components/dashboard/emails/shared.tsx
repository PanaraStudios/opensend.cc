"use client"

import * as React from "react"
import { cn } from "cn"
import { format } from "date-fns"
import { usePathname, useRouter } from "next/navigation"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar, CalendarDayButton } from "@/components/ui/calendar"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  PageHeader,
  emailStatusDotClassName,
} from "@/components/dashboard/primitives"
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
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  SearchIcon,
} from "lucide-react"
import { DEMO_NOW } from "@/lib/dashboard/data"
import {
  pickerPresets,
  rangeAfterCalendarClear,
  rangeFromPreset,
  rangeLabel,
  presetFromRange,
} from "@/lib/dashboard/email-range"
import { EMAIL_TABS, tabActive } from "@/lib/dashboard/nav"
import type { EmailStatus, SuppressionReason } from "@/lib/dashboard/types"

export {
  RANGE_PRESETS,
  defaultEmailRange,
  inDateRange,
  rangeFromPreset,
  rangeLabel,
  presetFromRange,
  type RangePreset,
} from "@/lib/dashboard/email-range"

export type SelectOption = {
  value: string
  label: string
  dotClassName?: string
}

function statusOption(value: EmailStatus, label: string): SelectOption {
  return { value, label, dotClassName: emailStatusDotClassName(value) }
}

export const STATUS_ITEMS: readonly SelectOption[] = [
  { value: "all", label: "All statuses", dotClassName: "bg-muted-foreground" },
  statusOption("delivered", "Delivered"),
  statusOption("opened", "Opened"),
  statusOption("clicked", "Clicked"),
  statusOption("sent", "Sent"),
  statusOption("scheduled", "Scheduled"),
  statusOption("bounced", "Bounced"),
  statusOption("failed", "Failed"),
  statusOption("canceled", "Canceled"),
  statusOption("suppressed", "Suppressed"),
]

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

const RANGE_DAY_BUTTON_CLASS =
  "data-[range-end=true]:bg-foreground data-[range-end=true]:text-background data-[range-middle=true]:bg-transparent data-[range-middle=true]:text-foreground data-[range-start=true]:bg-foreground data-[range-start=true]:text-background data-[selected-single=true]:bg-foreground data-[selected-single=true]:text-background"

const RANGE_TODAY_DOT_CLASS =
  "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-foreground data-[range-end=true]:after:bg-background data-[range-start=true]:after:bg-background data-[selected-single=true]:after:bg-background"

function RangeCalendarDayButton({
  className,
  modifiers,
  ...props
}: React.ComponentProps<typeof CalendarDayButton>) {
  return (
    <CalendarDayButton
      modifiers={modifiers}
      className={cn(
        RANGE_DAY_BUTTON_CLASS,
        modifiers.today && RANGE_TODAY_DOT_CLASS,
        className
      )}
      {...props}
    />
  )
}

const RANGE_CALENDAR_FORMATTERS = {
  formatWeekdayName: (date: Date) => format(date, "EEEEE"),
}

const RANGE_CALENDAR_CLASS_NAMES = {
  month: "flex w-full flex-col gap-3",
  weekday:
    "flex-1 text-center text-[0.7rem] font-normal text-muted-foreground select-none",
  week: "mt-1 flex w-full",
  day: "group/day relative aspect-square h-full w-full p-0 text-center select-none",
  range_start:
    "relative isolate z-0 rounded-l-md bg-muted after:absolute after:inset-y-0 after:right-0 after:w-1/2 after:bg-muted",
  range_middle: "rounded-none bg-muted",
  range_end:
    "relative isolate z-0 rounded-r-md bg-muted after:absolute after:inset-y-0 after:left-0 after:w-1/2 after:bg-muted",
  today: "bg-transparent",
  outside: "text-muted-foreground/40 aria-selected:text-muted-foreground",
}

const RANGE_CALENDAR_COMPONENTS = {
  DayButton: RangeCalendarDayButton,
}

const DEMO_TODAY = new Date(DEMO_NOW)

const PRESET_BUTTON_CLASS =
  "flex h-8 shrink-0 items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm whitespace-nowrap transition-colors sm:w-full"

const PRESET_BUTTON_SELECTED_CLASS = `${PRESET_BUTTON_CLASS} bg-muted text-foreground`

const PRESET_BUTTON_IDLE_CLASS = `${PRESET_BUTTON_CLASS} text-muted-foreground hover:bg-muted/60 hover:text-foreground`

function calendarMonthFromRange(range: DateRange | undefined): Date {
  return range?.to ?? range?.from ?? DEMO_TODAY
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
  const active = presetFromRange(range)
  const presets = pickerPresets(allowAllTime)
  const label = rangeLabel(range, allowAllTime)
  const rangeMonthKey = `${range?.from?.getTime() ?? ""}-${range?.to?.getTime() ?? ""}`
  const [month, setMonth] = React.useState(() => calendarMonthFromRange(range))
  const [monthRangeKey, setMonthRangeKey] = React.useState(rangeMonthKey)

  if (monthRangeKey !== rangeMonthKey) {
    setMonthRangeKey(rangeMonthKey)
    setMonth(calendarMonthFromRange(range))
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            aria-label={`Date range: ${label}`}
            className="h-8 max-w-full min-w-0 gap-1.5 has-data-[icon=inline-end]:pr-2"
          />
        }
      >
        <span className="truncate">{label}</span>
        <ChevronDownIcon
          data-icon="inline-end"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-100 group-data-popup-open/button:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(100vw-1.5rem,22rem)] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0 sm:w-auto"
      >
        <div className="flex max-h-[min(100dvh-2rem,36rem)] flex-col sm:flex-row">
          <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border p-2 [scrollbar-width:none] sm:min-w-36 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 [&::-webkit-scrollbar]:hidden">
            {presets.map((preset) => {
              const selected = active === preset.value
              return (
                <button
                  key={preset.value}
                  type="button"
                  aria-pressed={selected}
                  className={
                    selected
                      ? PRESET_BUTTON_SELECTED_CLASS
                      : PRESET_BUTTON_IDLE_CLASS
                  }
                  onClick={() => {
                    onRangeChange(rangeFromPreset(preset.value))
                  }}
                >
                  <span>{preset.label}</span>
                  {selected ? (
                    <CheckIcon className="size-3.5 shrink-0" strokeWidth={2.5} />
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="min-w-0 overflow-auto p-2">
            <Calendar
              mode="range"
              selected={range}
              month={month}
              onMonthChange={setMonth}
              today={DEMO_TODAY}
              onSelect={(next) => {
                if (!next?.from) {
                  onRangeChange(rangeAfterCalendarClear(allowAllTime))
                  return
                }
                onRangeChange(next)
              }}
              autoFocus
              className="mx-auto bg-transparent p-0 [--cell-size:--spacing(7)] sm:[--cell-size:--spacing(8)]"
              formatters={RANGE_CALENDAR_FORMATTERS}
              classNames={RANGE_CALENDAR_CLASS_NAMES}
              components={RANGE_CALENDAR_COMPONENTS}
            />
          </div>
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
          <DownloadIcon />
        </Button>
      ) : null}
    </div>
  )
}
