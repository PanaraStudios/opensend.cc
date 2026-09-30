import { endOfDay, format, isSameDay, startOfDay, subDays } from "date-fns"
import type { DateRange } from "react-day-picker"

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

/** The last 15 days, ending on the supplied clock or today. */
export function defaultEmailRange(now?: number): DateRange {
  return rangeFromPreset("15d", now)
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
  now = Date.now()
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
  range: DateRange | undefined,
  now?: number
): RangePreset | "custom" {
  if (!range?.from) return "all"
  for (const { value: preset } of RANGE_PRESETS) {
    const candidate = rangeFromPreset(preset, now)
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
  allowAllTime = false,
  now?: number
): string {
  if (!range?.from) return allowAllTime ? ALL_TIME_PRESET.label : "Date range"
  const preset = presetFromRange(range, now)
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
  allowAllTime: boolean,
  now?: number
): DateRange | undefined {
  return allowAllTime ? undefined : defaultEmailRange(now)
}

/** The range's first and last millisecond, whole days; none for all time. */
export function rangeBounds(range: DateRange | undefined): {
  from?: number
  to?: number
} {
  if (!range?.from) return {}
  return {
    from: startOfDay(range.from).getTime(),
    to: endOfDay(range.to ?? range.from).getTime(),
  }
}

export function inDateRange(
  timestamp: number,
  range: DateRange | undefined
): boolean {
  const { from = -Infinity, to = Infinity } = rangeBounds(range)
  return timestamp >= from && timestamp <= to
}
