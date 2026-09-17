import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isSameDay, subDays } from "date-fns"

import { DEMO_NOW } from "./data"
import {
  ALL_TIME_PRESET,
  defaultEmailRange,
  pickerPresets,
  presetFromRange,
  RANGE_PRESETS,
  rangeAfterCalendarClear,
  rangeFromPreset,
  rangeLabel,
  ROLLING_DAYS,
  type RollingPreset,
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

  it("labels the Last 3 days preset", () => {
    assert.equal(rangeLabel(rangeFromPreset("3d")), "Last 3 days")
  })
})

describe("rangeFromPreset", () => {
  const now = new Date(DEMO_NOW)

  for (const preset of Object.keys(ROLLING_DAYS) as RollingPreset[]) {
    const days = ROLLING_DAYS[preset]

    it(`makes ${preset} an inclusive ${days}-day window ending on DEMO_NOW`, () => {
      const range = rangeFromPreset(preset)
      assert.ok(range.from)
      assert.ok(range.to)
      assert.ok(isSameDay(range.to, now))
      assert.ok(isSameDay(range.from, subDays(now, days - 1)))
    })
  }

  it("makes today a single-day window on DEMO_NOW", () => {
    const range = rangeFromPreset("today")
    assert.ok(range.from)
    assert.ok(isSameDay(range.from, now))
    assert.ok(range.to && isSameDay(range.to, now))
  })

  it("makes yesterday a single-day window before DEMO_NOW", () => {
    const range = rangeFromPreset("yesterday")
    const yesterday = subDays(now, 1)
    assert.ok(range.from)
    assert.ok(isSameDay(range.from, yesterday))
    assert.ok(range.to && isSameDay(range.to, yesterday))
  })

  it("returns undefined for all time", () => {
    assert.equal(rangeFromPreset("all"), undefined)
  })
})

describe("presetFromRange", () => {
  for (const { value: preset } of RANGE_PRESETS) {
    it(`round-trips ${preset}`, () => {
      assert.equal(presetFromRange(rangeFromPreset(preset)), preset)
    })
  }

  it("treats an empty range as all", () => {
    assert.equal(presetFromRange(undefined), "all")
  })
})

describe("pickerPresets", () => {
  it("omits All time when it is not allowed", () => {
    assert.ok(pickerPresets(false).every((preset) => preset.value !== "all"))
  })

  it("includes All time first when it is allowed", () => {
    const presets = pickerPresets(true)
    assert.equal(presets[0], ALL_TIME_PRESET)
    assert.equal(presets[0]?.value, "all")
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
    assert.equal(rangeAfterCalendarClear(true), undefined)
  })
})
