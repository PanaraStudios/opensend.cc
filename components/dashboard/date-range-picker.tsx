"use client"

import * as React from "react"
import { cn } from "cn"
import { format } from "date-fns"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar, CalendarDayButton } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { DEMO_NOW } from "@/lib/dashboard/data"
import {
  pickerPresets,
  rangeAfterCalendarClear,
  rangeFromPreset,
  rangeLabel,
  presetFromRange,
} from "@/lib/dashboard/email-range"

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
  /* Remount the calendar when the range changes so it opens on that month. */
  const rangeMonthKey = `${range?.from?.getTime() ?? ""}-${range?.to?.getTime() ?? ""}`

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
          <div className="flex shrink-0 [scrollbar-width:none] gap-0.5 overflow-x-auto border-b border-border p-2 sm:min-w-36 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0 [&::-webkit-scrollbar]:hidden">
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
                    <CheckIcon
                      className="size-3.5 shrink-0"
                      strokeWidth={2.5}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="min-w-0 overflow-auto p-2">
            <Calendar
              mode="range"
              selected={range}
              key={rangeMonthKey}
              defaultMonth={calendarMonthFromRange(range)}
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
