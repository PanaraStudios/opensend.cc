import { endOfDay, format, isSameDay, startOfDay, subDays } from "date-fns"
import type { DateRange } from "react-day-picker"

import { DEMO_NOW } from "./data"

export const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "15d", label: "Last 15 days" },
  { value: "30d", label: "Last 30 days" },
] as const

export type RangePreset = (typeof RANGE_PRESETS)[number]["value"] | "all"

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

export function presetFromRange(
  range: DateRange | undefined
): RangePreset | "custom" {
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
  if (!range?.from) return allowAllTime ? "All time" : "Date range"
  const preset = presetFromRange(range)
  if (preset !== "custom") {
    return (
      RANGE_PRESETS.find((item) => item.value === preset)?.label ?? "Date range"
    )
  }
  if (!range.to) return format(range.from, "MMM d, yyyy")
  return `${format(range.from, "MMM d")} - ${format(range.to, "MMM d, yyyy")}`
}

export function rangeAfterCalendarClear(
  allowAllTime: boolean
): DateRange | undefined {
  return allowAllTime ? rangeFromPreset("all") : defaultEmailRange()
}

export function shouldCloseDateRangePicker(
  range: DateRange | undefined
): boolean {
  return Boolean(range?.from && range.to && !isSameDay(range.from, range.to))
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
