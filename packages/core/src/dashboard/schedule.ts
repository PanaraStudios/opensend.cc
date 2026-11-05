import * as chrono from "chrono-node"
import { format } from "date-fns"

import { sentenceCase } from "./format"

/** One row of the "When" menu. `at` is null for "send now". */
export type ScheduleOption = {
  label: string
  at: number | null
}

export const SEND_NOW: ScheduleOption = { label: "Now", at: null }

const PRESETS = ["Tomorrow", "Tomorrow afternoon", "Tomorrow morning"]

/** A typed phrase as a future timestamp, or null when it names no such time. */
export function parseSchedule(text: string, now: number): number | null {
  const date = chrono.parseDate(text, new Date(now), { forwardDate: true })
  if (!date) return null
  const at = date.getTime()
  return at > now ? at : null
}

/** "Now" and the presets matching the query, or the query itself once it
    reads as a date ("in 3 days", "friday 9am"). A typed date goes first so
    Enter picks it rather than "Now". */
export function scheduleOptions(query: string, now: number): ScheduleOption[] {
  const text = query.trim().replace(/\s+/g, " ")
  const needle = text.toLowerCase()
  const presets: ScheduleOption[] = []

  for (const label of PRESETS) {
    if (!label.toLowerCase().startsWith(needle)) continue
    const at = parseSchedule(label, now)
    if (at !== null) presets.push({ label, at })
  }
  if (!needle || "now".startsWith(needle)) return [SEND_NOW, ...presets]
  if (presets.length > 0) return [...presets, SEND_NOW]

  const at = parseSchedule(text, now)
  return at === null
    ? [SEND_NOW]
    : [{ label: sentenceCase(text), at }, SEND_NOW]
}

/** "Sep 21st, 4:22PM", with the minutes dropped on the hour. */
export function formatScheduleHint(at: number): string {
  const minutes = new Date(at).getMinutes()
  return format(at, minutes === 0 ? "MMM do, ha" : "MMM do, h:mma")
}

/** "Asia/Kolkata (GMT+5:30)" for the viewer's own clock. */
export function timeZoneLabel(now: number): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offset = -new Date(now).getTimezoneOffset()
  const sign = offset < 0 ? "-" : "+"
  const hours = Math.floor(Math.abs(offset) / 60)
  const minutes = Math.abs(offset) % 60
  const suffix = minutes ? `:${String(minutes).padStart(2, "0")}` : ""
  return `${zone} (GMT${sign}${hours}${suffix})`
}
