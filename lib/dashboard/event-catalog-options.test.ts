import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  automationCatalogNames,
  CATALOG_SELECTED_LIMIT,
} from "./event-catalog-options"
import type { AutomationStep } from "./types"

test("catalog names retain trigger and nested wait event schemas without duplicates", () => {
  const steps = [
    {
      key: "wait",
      type: "wait_for_event",
      eventName: "late.event",
      timeout: "1 minute",
      received: [
        {
          key: "nested",
          type: "wait_for_event",
          eventName: "other.event",
          timeout: "1 minute",
          received: [],
          timedOut: [],
        },
      ],
      timedOut: [],
    },
  ] as AutomationStep[]
  assert.deepEqual(automationCatalogNames("late.event", steps), [
    "late.event",
    "other.event",
  ])
  assert.deepEqual(automationCatalogNames("", []), [])
  assert.equal(
    automationCatalogNames(
      "trigger",
      Array.from(
        { length: 120 },
        (_, i) =>
          ({
            key: `wait${i}`,
            type: "wait_for_event",
            eventName: `event${i}`,
            timeout: "1 minute",
            received: [],
            timedOut: [],
          }) as AutomationStep
      )
    ).length,
    CATALOG_SELECTED_LIMIT
  )
})
