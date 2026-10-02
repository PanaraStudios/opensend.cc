import { SYSTEM_EVENTS, triggerEventError } from "./automation"
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  automationTasks,
  cleanSchema,
  durationError,
  formatDuration,
  evaluateRule,
  eventNameError,
  findStep,
  flattenSteps,
  formatRunDuration,
  insertStep,
  newStep,
  parseDuration,
  payloadErrors,
  removeStep,
  replaceStep,
  samplePayload,
  schemaError,
  stepSummary,
  stepTitle,
  type StepContext,
} from "./automation"
import type { AutomationStep } from "./types"

const context: StepContext = {
  templates: [
    { id: "tpl_live", name: "Welcome", status: "published" },
    { id: "tpl_draft", name: "Invoice", status: "draft" },
  ],
  segments: [{ id: "seg_1", name: "Customers" }],
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

  it("does not reuse the key of a step the run history still names", () => {
    assert.equal(newStep("delay", [], ["delay", "delay_2"]).key, "delay_3")
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

  it("saves property names trimmed, and refuses odd or repeated ones", () => {
    assert.deepEqual(
      cleanSchema([
        { key: " plan ", type: "string" },
        { key: "  ", type: "number" },
      ]),
      [{ key: "plan", type: "string" }]
    )
    assert.equal(schemaError([{ key: "plan ", type: "string" }]), null)
    assert.match(
      schemaError([{ key: "signup-source", type: "string" }]) ?? "",
      /letters, numbers and underscores/
    )
    assert.match(
      schemaError([
        { key: "plan", type: "string" },
        { key: "plan", type: "number" },
      ]) ?? "",
      /twice/
    )
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

it("supports a WhatsApp step and known system events for triggers and reply waits", () => {
  const step = newStep("send_whatsapp", [])
  assert.equal(step.type, "send_whatsapp")
  assert.equal(stepTitle(step), "Send WhatsApp")
  assert.ok(eventNameError("opensend:whatsapp.message.received"))
  assert.equal(
    eventNameError("opensend:whatsapp.message.received", [], {
      allowSystem: true,
    }),
    null
  )
  assert.ok(eventNameError("opensend:unknown", [], { allowSystem: true }))
  assert.deepEqual(
    automationTasks(
      {
        trigger: "opensend:whatsapp.message.received",
        steps: [
          {
            ...step,
            accountId: "number",
            mode: "template",
            templateId: "approved",
            variables: {},
          } as AutomationStep,
        ],
      },
      { templates: [], segments: [] }
    ),
    []
  )
})

it("all messaging reply events are valid triggers but custom system names are refused", () => {
  assert.ok(SYSTEM_EVENTS.some(event => event.value === "opensend:email.opened"))
  assert.ok(SYSTEM_EVENTS.some(event => event.value === "opensend:whatsapp.call.completed"))
  for (const event of SYSTEM_EVENTS)
    assert.equal(triggerEventError(event.value), null)
  assert.match(triggerEventError("opensend:unknown")!, /reserved/)
  assert.equal(triggerEventError("customer.created"), null)
})

for (const channel of ["messenger", "instagram"] as const) {
  it(`builds and validates a ${channel} send step with the shared config`, () => {
    const step = newStep(`send_${channel}`, [])
    assert.equal(step.type, `send_${channel}`)
    assert.equal(
      stepTitle(step),
      `Send ${channel === "messenger" ? "Messenger" : "Instagram"} message`
    )
    const draft = {
      ...step,
      accountId: "page",
      mode: "template" as const,
      templateId: "published",
      variables: {},
    } as AutomationStep
    assert.deepEqual(
      automationTasks(
        { trigger: `opensend:${channel}.message.received`, steps: [draft] },
        context
      ),
      []
    )
    assert.equal(
      stepSummary(draft, {
        ...context,
        templates: [{ id: "published", name: "Reply", status: "published" }],
      }),
      "Reply"
    )
    const text = {
      ...draft,
      mode: "text" as const,
      text: "Hello",
    } as AutomationStep
    assert.equal(stepSummary(text, context), "Hello")
    assert.deepEqual(
      automationTasks(
        {
          trigger: `opensend:${channel}.message.received`,
          steps: [{ ...text, text: "" } as AutomationStep],
        },
        context
      ).flatMap((task) => task.tasks),
      ["Enter a message"]
    )
  })
}
