import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { addDays, isSameDay } from "date-fns"

import { DEMO_NOW } from "./data"
import {
  defaultEmailRange,
  presetFromRange,
  rangeAfterCalendarClear,
  rangeFromPreset,
  rangeLabel,
  shouldCloseDateRangePicker,
} from "./email-range"

describe("rangeLabel", () => {
  it("does not say All time when the empty range is not allowed", () => {
    assert.equal(rangeLabel(undefined, false), "Date range")
  })

  it("says All time when the empty range is allowed", () => {
    assert.equal(rangeLabel(undefined, true), "All time")
  })

  it("labels the default sending range as Last 15 days", () => {
    assert.equal(rangeLabel(defaultEmailRange()), "Last 15 days")
  })
})

describe("rangeAfterCalendarClear", () => {
  it("snaps Sending and Receiving back to Last 15 days", () => {
    const next = rangeAfterCalendarClear(false)
    const expected = defaultEmailRange()
    assert.ok(next?.from && expected.from)
    assert.ok(isSameDay(next.from, expected.from))
    assert.ok(next.to && expected.to && isSameDay(next.to, expected.to))
    assert.equal(presetFromRange(next), "15d")
  })

  it("uses the all-time preset on Suppressions", () => {
    assert.equal(rangeAfterCalendarClear(true), rangeFromPreset("all"))
    assert.equal(rangeAfterCalendarClear(true), undefined)
  })
})

describe("shouldCloseDateRangePicker", () => {
  const day = new Date(DEMO_NOW)

  it("stays open on the first DayPicker click", () => {
    assert.equal(shouldCloseDateRangePicker({ from: day, to: day }), false)
  })

  it("stays open when only the start day is set", () => {
    assert.equal(shouldCloseDateRangePicker({ from: day }), false)
  })

  it("closes after a second day completes the range", () => {
    assert.equal(
      shouldCloseDateRangePicker({ from: day, to: addDays(day, 3) }),
      true
    )
  })

  it("stays open when the range is empty", () => {
    assert.equal(shouldCloseDateRangePicker(undefined), false)
  })
})
