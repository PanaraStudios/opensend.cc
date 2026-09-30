import assert from "node:assert/strict"
import { test } from "node:test"
import {
  csvTime,
  exportFileName,
  exportOutcome,
  exportSummary,
  pgTimestamp,
} from "./exports"
import { EXPORT_STATUS_TONE, exportStatusLabel, formatRelative } from "./format"

test("export names and timestamps match the CSV contract", () => {
  const time = Date.UTC(2026, 6, 2, 18, 11, 32, 270)
  assert.equal(exportFileName("api-keys", time), `api-keys-${time}.csv`)
  assert.equal(pgTimestamp(time), "2026-07-02 18:11:32.270000+00")
  assert.equal(csvTime(null), "")
  assert.equal(csvTime(0), "1970-01-01 00:00:00.000000+00")
})
test("summary uses the displayed filter labels, search and date timezone", () => {
  assert.deepEqual(
    exportSummary({
      search: "  Ada  ",
      date: "Last 15 days",
      timezone: "UTC",
      filters: [
        {
          value: "all",
          "aria-label": "Filter by user agent",
          items: [{ value: "all", label: "All user agents" }],
        },
      ],
    }),
    [
      { label: "Search", value: "Ada" },
      { label: "Date", value: "Last 15 days" },
      { label: "Timezone", value: "UTC" },
      { label: "User agent", value: "All user agents" },
    ]
  )
  assert.deepEqual(exportSummary({ search: "  " }), [])
})
test("only admins auto-download completed exports up to 1000 rows", () => {
  for (const rows of [0, 999, 1000]) {
    assert.equal(exportOutcome({ status: "ready", rows }, true), "download")
    assert.equal(exportOutcome({ status: "ready", rows }, false), "listed")
  }
  assert.equal(exportOutcome({ status: "ready", rows: 1001 }, true), "listed")
  assert.equal(exportOutcome(undefined, true), "wait")
  assert.equal(exportOutcome({ status: "processing", rows: 0 }, true), "wait")
  for (const status of ["failed", "expired"])
    assert.equal(exportOutcome({ status, rows: 0 }, true), "failed")
  assert.equal(exportOutcome(null, true), "failed")
})
test("completed, failed and future expiry labels stay distinct", () => {
  assert.equal(exportStatusLabel("ready"), "Completed")
  assert.equal(exportStatusLabel("failed"), "Failed")
  assert.equal(EXPORT_STATUS_TONE.failed, "destructive")
  assert.equal(formatRelative(7 * 86400000, 0), "in 7d")
})
