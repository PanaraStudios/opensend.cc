import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  automationTasks,
  cancelledRun,
  durationError,
  formatDuration,
  evaluateRule,
  eventListeners,
  eventNameError,
  findStep,
  flattenSteps,
  formatRunDuration,
  insertStep,
  newStep,
  normalizeAutomation,
  parseDuration,
  payloadErrors,
  removeStep,
  runStatusRates,
  replaceStep,
  samplePayload,
  startRun,
  stepProblem,
  stepMetrics,
  stepSummary,
  stepTitle,
  type StepContext,
} from "./automation"
import type { AutomationStep, Contact } from "./types"

const context: StepContext = {
  templates: [
    { id: "tpl_live", name: "Welcome", status: "published" },
    { id: "tpl_draft", name: "Invoice", status: "draft" },
  ],
  segments: [{ id: "seg_1", name: "Customers" }],
}

const contact: Contact = {
  id: "con_1",
  email: "ada@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  createdAt: 1,
  unsubscribed: false,
  segmentIds: [],
  topics: [],
  properties: { company: "Analytical" },
}

const send = (key: string, templateId = "tpl_live"): AutomationStep => ({
  key,
  type: "send_email",
  templateId,
  from: "",
  replyTo: "",
  variables: {},
})

const condition = (
  met: AutomationStep[],
  notMet: AutomationStep[]
): AutomationStep => ({
  key: "is_team",
  type: "condition",
  match: "and",
  rules: [{ field: "event.plan", operator: "eq", value: "team" }],
  met,
  notMet,
})

describe("the workflow tree", () => {
  const steps = [send("first"), condition([send("yes")], [send("no")])]

  it("flattens parents before their branches", () => {
    assert.deepEqual(
      flattenSteps(steps).map((step) => step.key),
      ["first", "is_team", "yes", "no"]
    )
  })

  it("finds and replaces a nested step", () => {
    const next = replaceStep(steps, {
      ...send("no"),
      from: "hi@example.com",
    } as AutomationStep)
    const found = findStep(next, "no")
    assert.equal(found?.type === "send_email" && found.from, "hi@example.com")
    assert.equal(findStep(steps, "no")?.type, "send_email")
  })

  it("removes a branching step with its paths", () => {
    assert.deepEqual(
      flattenSteps(removeStep(steps, "is_team")).map((step) => step.key),
      ["first"]
    )
  })

  it("inserts into a branch", () => {
    const next = insertStep(
      steps,
      { parent: { key: "is_team", branch: "notMet" }, index: 0 },
      send("nudge")
    )
    assert.deepEqual(
      flattenSteps(next).map((step) => step.key),
      ["first", "is_team", "yes", "nudge", "no"]
    )
  })

  it("moves what followed a new branching step onto its first path", () => {
    const next = insertStep(
      [send("a"), send("b")],
      { parent: null, index: 1 },
      condition([], [])
    )
    assert.deepEqual(
      next.map((step) => step.key),
      ["a", "is_team"]
    )
    const branch = next[1]
    assert.deepEqual(
      branch?.type === "condition" && branch.met.map((step) => step.key),
      ["b"]
    )
  })

  it("keys new steps uniquely, in snake case", () => {
    const first = newStep("send_email", [])
    assert.equal(first.key, "send_email")
    assert.equal(newStep("send_email", [first]).key, "send_email_2")
  })
})

describe("durations and names", () => {
  it("parses human durations", () => {
    assert.equal(parseDuration("30 minutes"), 30 * 60_000)
    assert.equal(parseDuration("1 week"), 7 * 86_400_000)
    assert.equal(parseDuration("2h"), 2 * 3_600_000)
    assert.equal(parseDuration("1h 30m"), 90 * 60_000)
    assert.equal(parseDuration("soon"), null)
    assert.equal(parseDuration("2h later"), null)
    assert.equal(parseDuration("0 days"), null)
  })

  it("reads a duration back in its largest whole unit", () => {
    assert.equal(formatDuration("1h 30m"), "90 minutes")
    assert.equal(formatDuration("7 days"), "1 week")
    assert.equal(formatDuration("60m"), "1 hour")
    assert.equal(formatDuration("nope"), null)
  })

  it("caps a wait at 30 days", () => {
    assert.equal(durationError("30 days"), null)
    assert.match(durationError("31 days") ?? "", /30 days/)
  })

  it("reserves the system prefix and refuses duplicates", () => {
    assert.equal(eventNameError("user.created"), null)
    assert.match(eventNameError("opensend:ping") ?? "", /reserved/)
    assert.match(eventNameError("a", ["a"]) ?? "", /already exists/)
    assert.match(eventNameError("  ") ?? "", /Enter/)
  })
})

describe("validation", () => {
  it("needs a published template to send", () => {
    assert.equal(stepProblem(send("a"), context), null)
    assert.match(stepProblem(send("a", "tpl_draft"), context) ?? "", /Publish/)
    assert.match(stepProblem(send("a", ""), context) ?? "", /Select/)
  })

  it("needs complete, scoped rules", () => {
    const step = condition([], [])
    assert.equal(stepProblem(step, context), null)
    assert.equal(
      stepProblem(
        {
          ...step,
          rules: [{ field: "plan", operator: "eq", value: "x" }],
        } as AutomationStep,
        context
      ),
      "Add a condition"
    )
  })

  it("lists what is left before an automation can start", () => {
    assert.deepEqual(automationTasks({ trigger: "", steps: [] }, context), [
      {
        key: "start",
        type: "trigger",
        title: "Custom event",
        tasks: ["Set event", "Add a step"],
      },
    ])
    assert.deepEqual(
      automationTasks(
        { trigger: "a", steps: [send("x", ""), send("y")] },
        context
      ).map((item) => [item.key, item.tasks]),
      [["x", ["Select an email template"]]]
    )
    assert.deepEqual(
      automationTasks({ trigger: "a", steps: [send("x")] }, context),
      []
    )
  })

  it("names and summarises a step on its card", () => {
    assert.equal(stepSummary(send("a"), context), "Welcome")
    assert.equal(
      stepSummary(condition([], []), context),
      'plan is equal to "team"'
    )
    assert.equal(
      stepTitle({ key: "d", type: "delay", duration: "1h 30m" }),
      "90 minutes"
    )
    assert.equal(
      stepTitle({
        key: "u",
        type: "contact_update",
        fields: [{ property: "first_name", action: "change", value: "Ada" }],
      }),
      "Update contact: first name"
    )
  })

  it("lists the automations an event starts or continues", () => {
    const waiting: AutomationStep = {
      key: "w",
      type: "wait_for_event",
      eventName: "paid",
      timeout: "1 day",
      received: [],
      timedOut: [],
    }
    const all = [
      { id: "1", trigger: "signup", steps: [waiting] },
      { id: "2", trigger: "paid", steps: [] },
      { id: "3", trigger: "other", steps: [] },
    ]
    assert.deepEqual(
      eventListeners(all, "paid").map((item) => item.id),
      ["1", "2"]
    )
  })
})

describe("rules", () => {
  const scope = {
    event: { plan: "team", seats: 12 },
    contact: { email: "ada@example.com", properties: { company: "Acme" } },
  }
  const rule = (field: string, operator: string, value = "") =>
    evaluateRule({ field, operator, value } as never, scope)

  it("compares text and numbers", () => {
    assert.equal(rule("event.plan", "eq", "team"), true)
    assert.equal(rule("event.seats", "gte", "12"), true)
    assert.equal(rule("event.seats", "lt", "5"), false)
    assert.equal(rule("contact.email", "ends_with", "@example.com"), true)
    assert.equal(rule("contact.properties.company", "contains", "cm"), true)
  })

  it("handles missing fields", () => {
    assert.equal(rule("event.missing", "exists"), false)
    assert.equal(rule("event.missing", "is_empty"), true)
    assert.equal(rule("event.missing", "eq", "x"), false)
    assert.equal(rule("event.missing", "neq", "x"), true)
  })
})

describe("runs", () => {
  const run = (steps: AutomationStep[], who = contact, payload = {}) =>
    startRun({
      id: "run_1",
      automation: { id: "atm_1", trigger: "user.created", steps },
      contact: who,
      payload,
      context,
      now: 1000,
    })

  it("follows the path the payload picks", () => {
    const result = run([condition([send("yes")], [send("no")])], contact, {
      plan: "team",
    })
    assert.equal(result.status, "completed")
    assert.deepEqual(
      result.steps.map((step) => step.key),
      ["start", "is_team", "yes"]
    )
  })

  it("stays running at a delay", () => {
    const result = run([
      { key: "wait", type: "delay", duration: "1 day" },
      send("later"),
    ])
    assert.equal(result.status, "running")
    assert.equal(result.completedAt, null)
    assert.equal(result.steps.at(-1)?.status, "running")
  })

  it("fails on a step that is not set up", () => {
    const result = run([send("a", "tpl_draft"), send("b")])
    assert.equal(result.status, "failed")
    assert.equal(result.steps.length, 2)
    assert.match(result.steps[1]?.error ?? "", /Publish/)
  })

  it("skips emails to an unsubscribed contact but keeps going", () => {
    const result = run(
      [send("a"), { key: "seg", type: "add_to_segment", segmentId: "seg_1" }],
      { ...contact, unsubscribed: true }
    )
    assert.deepEqual(
      result.steps.map((step) => step.status),
      ["completed", "skipped", "completed"]
    )
  })

  it("cancels only a run that is waiting", () => {
    const waiting = run([{ key: "wait", type: "delay", duration: "1 day" }])
    const stopped = cancelledRun(waiting, 2000)
    assert.equal(stopped.status, "cancelled")
    assert.equal(stopped.steps.at(-1)?.status, "cancelled")
    const done = run([send("a")])
    assert.equal(cancelledRun(done, 2000), done)
  })

  it("measures the runs", () => {
    const waiting = run([{ key: "wait", type: "delay", duration: "1 day" }])
    const done = run([send("a")])
    assert.deepEqual(runStatusRates([waiting, done, done, done]), {
      running: 25,
      completed: 75,
      failed: 0,
      cancelled: 0,
    })
    assert.deepEqual(stepMetrics([waiting, done]).get("a"), {
      executions: 1,
      averageMs: 0,
    })
    assert.deepEqual(stepMetrics([waiting]).get("wait"), {
      executions: 1,
      averageMs: null,
    })
  })

  it("formats how long a run took", () => {
    assert.equal(
      formatRunDuration({ startedAt: 0, completedAt: 5000 }, 0),
      "5s"
    )
    assert.equal(
      formatRunDuration({ startedAt: 0, completedAt: null }, 7_200_000),
      "2h"
    )
  })
})

describe("event payloads", () => {
  const event = {
    schema: [
      { key: "plan", type: "string" as const },
      { key: "seats", type: "number" as const },
      { key: "at", type: "date" as const },
    ],
  }

  it("samples a payload that passes its own schema", () => {
    assert.deepEqual(payloadErrors(event, samplePayload(event)), [])
  })

  it("reports missing and mistyped fields", () => {
    assert.deepEqual(payloadErrors(event, { plan: 1, at: "nope" }), [
      "plan must be a string",
      "seats is missing",
      "at must be a date",
    ])
    assert.deepEqual(payloadErrors(undefined, { anything: true }), [])
  })
})

describe("migration", () => {
  it("gives an automation saved without steps an empty workflow", () => {
    const next = normalizeAutomation({
      id: "atm_1",
      name: "Old",
      status: "disabled",
      trigger: "contact.created",
      createdAt: 5,
    })
    assert.deepEqual(next.steps, [])
  })
})
