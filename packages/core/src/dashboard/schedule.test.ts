import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  formatScheduleHint,
  parseSchedule,
  scheduleOptions,
  SEND_NOW,
} from "./schedule"

/* Friday, Sep 18th 2026, 4:22 PM local time. */
const NOW = new Date(2026, 8, 18, 16, 22).getTime()

describe("scheduleOptions", () => {
  it("offers Now and the presets for an empty query", () => {
    const options = scheduleOptions("", NOW)
    assert.deepEqual(
      options.map((option) => option.label),
      ["Now", "Tomorrow", "Tomorrow afternoon", "Tomorrow morning"]
    )
    assert.equal(options[0], SEND_NOW)
    assert.equal(options[1].at, new Date(2026, 8, 19, 16, 22).getTime())
    assert.equal(options[2].at, new Date(2026, 8, 19, 15, 0).getTime())
    assert.equal(options[3].at, new Date(2026, 8, 19, 6, 0).getTime())
  })

  it("narrows the presets as the query grows", () => {
    assert.deepEqual(
      scheduleOptions("tomorrow m", NOW).map((option) => option.label),
      ["Tomorrow morning", "Now"]
    )
  })

  it("reads a typed phrase as a date", () => {
    const options = scheduleOptions("in 3 days", NOW)
    assert.deepEqual(options, [
      { label: "In 3 days", at: new Date(2026, 8, 21, 16, 22).getTime() },
      SEND_NOW,
    ])
  })

  it("offers only Now for text that is not a date", () => {
    assert.deepEqual(scheduleOptions("banana", NOW), [SEND_NOW])
  })
})

describe("parseSchedule", () => {
  it("rejects times that have passed", () => {
    assert.equal(parseSchedule("September 1st 2026", NOW), null)
  })
})

describe("formatScheduleHint", () => {
  it("drops the minutes on the hour", () => {
    assert.equal(
      formatScheduleHint(new Date(2026, 8, 19, 15, 0).getTime()),
      "Sep 19th, 3PM"
    )
    assert.equal(
      formatScheduleHint(new Date(2026, 8, 21, 16, 22).getTime()),
      "Sep 21st, 4:22PM"
    )
  })
})
