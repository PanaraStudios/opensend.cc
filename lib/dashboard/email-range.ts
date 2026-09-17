import { endOfDay, format, isSameDay, startOfDay, subDays } from "date-fns"
import type { DateRange } from "react-day-picker"

import { DEMO_NOW } from "./data"
import { formatDate } from "./format"

export const RANGE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
  { value: "15d", label: "Last 15 days" },
  { value: "30d", label: "Last 30 days" },
] as const

export const ALL_TIME_PRESET = { value: "all", label: "All time" } as const

const PRESETS_WITH_ALL_TIME = [ALL_TIME_PRESET, ...RANGE_PRESETS] as const

/** Inclusive day span: `days` total calendar days ending today. */
export const ROLLING_DAYS = {
  "3d": 3,
  "7d": 7,
  "15d": 15,
  "30d": 30,
} as const

export type RollingPreset = keyof typeof ROLLING_DAYS
export type NamedRangePreset = (typeof RANGE_PRESETS)[number]["value"]
export type RangePreset = NamedRangePreset | "all"

export function defaultEmailRange(): DateRange {
  return rangeFromPreset("15d")
}

function lastDays(current: Date, days: number): DateRange {
  return {
    from: startOfDay(subDays(current, days - 1)),
    to: endOfDay(current),
  }
}

export function rangeFromPreset(preset: "all", now?: number): undefined
export function rangeFromPreset(
  preset: NamedRangePreset,
  now?: number
): DateRange
export function rangeFromPreset(
  preset: RangePreset,
  now?: number
): DateRange | undefined
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
    case "3d":
    case "7d":
    case "15d":
    case "30d":
      return lastDays(current, ROLLING_DAYS[preset])
    case "all":
      return undefined
  }
}

export function presetFromRange(
  range: DateRange | undefined
): RangePreset | "custom" {
  if (!range?.from) return "all"
  for (const { value: preset } of RANGE_PRESETS) {
    const candidate = rangeFromPreset(preset)
    if (
      candidate.from &&
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
  if (!range?.from) return allowAllTime ? ALL_TIME_PRESET.label : "Date range"
  const preset = presetFromRange(range)
  if (preset !== "custom" && preset !== "all") {
    return (
      RANGE_PRESETS.find((item) => item.value === preset)?.label ?? "Date range"
    )
  }
  if (!range.to) return formatDate(range.from.getTime())
  return `${format(range.from, "MMM d")} - ${formatDate(range.to.getTime())}`
}

export function pickerPresets(allowAllTime: boolean) {
  return allowAllTime ? PRESETS_WITH_ALL_TIME : RANGE_PRESETS
}

export function rangeAfterCalendarClear(
  allowAllTime: boolean
): DateRange | undefined {
  return allowAllTime ? undefined : defaultEmailRange()
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
