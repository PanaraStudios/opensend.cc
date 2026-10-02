import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { previousSteps, referenceErrors, resolveReference, resolveText, variableOptions, stepOutputSchema } from "./automation-references"
import { eventCatalog, schemaField, SYSTEM_EVENT_CATALOG } from "./event-catalog"
import type { AutomationStep } from "./dashboard/types"
const scope = { trigger: { message: { text: '<b>price & "quote"</b>', attachments: [{ filename: "quote.pdf" }] }, count: 5, enabled: false }, contact: { first_name: "Ada" }, steps: { sent: { message_id: "m1" } } }
const catalog = eventCatalog([{ name: "paid", schema: [{ key: "total", type: "number" }] }], [{ key: "plan" }])
const update: AutomationStep = { key: "update", type: "contact_update", fields: [{ property: "first_name", action: "change", value: "{{trigger.text}}" }] }
describe("safe shared interpolation", () => {
  it("resolves nested objects, array paths, typed values, missing values and fallbacks", () => {
    assert.equal(resolveReference("{{trigger.count}}", scope), 5)
    assert.equal(resolveReference("{{trigger.enabled}}", scope), false)
    assert.equal(resolveReference("{{trigger.message.attachments[0].filename}}", scope), "quote.pdf")
    assert.equal(resolveText("{{steps.sent.message_id}} {{contact.first_name}}", scope), "m1 Ada")
    assert.equal(resolveText("missing {{trigger.nope}}", scope), "missing ")
    assert.equal(resolveReference("{{trigger.nope}}", scope, { fallback: "fallback" }), "fallback")
    assert.equal(resolveReference("event.count", { ...scope, event: scope.trigger }, { legacy: true }), 5)
  })
  it("escapes HTML exactly once and never traverses prototypes or executes code", () => {
    assert.equal(resolveText("{{trigger.message.text}}", scope, { html: true }), "&lt;b&gt;price &amp; &quot;quote&quot;&lt;/b&gt;")
    assert.equal(resolveText("{{contact.constructor.name}}", scope), "")
    assert.equal(resolveText("{{trigger.__proto__.toString}}", scope), "")
    assert.equal(resolveText("{{trigger.count}} + alert(1)", scope), "5 + alert(1)")
  })
})
describe("builder references and save validation", () => {
  it("declares outputs for every step and only exposes prior reachable steps", () => {
    const branch: AutomationStep = { key: "branch", type: "condition", match: "and", rules: [], met: [{ ...update, key: "yes", fields: [] }], notMet: [{ key: "no", type: "delay", duration: "1h" }] }
    const steps: AutomationStep[] = [{ key: "sent", type: "send_whatsapp", accountId: "a", mode: "text", variables: {}, text: "hi" }, branch]
    assert.deepEqual(previousSteps(steps, "yes")?.map(s => s.key), ["sent", "branch"])
    const options = variableOptions("opensend:whatsapp.message.received", steps, "yes", catalog)
    assert.ok(options.some(option => option.path === "steps.sent.message_id"))
    assert.ok(options.some(option => option.path === "trigger.message.text"))
    assert.ok(!options.some(option => option.path.startsWith("steps.no.")))
    assert.equal(stepOutputSchema(steps[0], catalog).fields?.status.type, "enum")
    assert.equal(stepOutputSchema(branch, catalog).fields?.branch.type, "enum")
    assert.equal(schemaField(catalog[0].schema, "contact.properties.plan")?.type, "string")
  })
  it("rejects unknown, future and sibling references and incompatible condition operands", () => {
    assert.match(referenceErrors("paid", [{ ...update, fields: [{ property: "first_name", action: "change", value: "{{trigger.typo}}" }] }], catalog).join(), /Unknown/)
    assert.match(referenceErrors("paid", [{ ...update, fields: [{ property: "first_name", action: "change", value: "{{steps.later.message_id}}" }] }, { key: "later", type: "contact_delete" }], catalog).join(), /unreachable/)
    const condition: AutomationStep = { key: "c", type: "condition", match: "and", rules: [{ field: "trigger.total", operator: "contains", value: "hi" }], met: [], notMet: [] }
    assert.match(referenceErrors("paid", [condition], catalog).join(), /requires a string/)
    condition.rules = [{ field: "trigger.total", operator: "gt", value: "{{contact.first_name}}" }]
    assert.match(referenceErrors("paid", [condition], catalog).join(), /comparison is string/)
    condition.rules = [{ field: "trigger.total", operator: "gte", value: "5" }]
    assert.deepEqual(referenceErrors("paid", [condition], catalog), [])
  })
  it("lists the team's custom definitions and all system events without sharing properties across teams", () => {
    assert.equal(catalog.length, SYSTEM_EVENT_CATALOG.length + 1)
    assert.equal(catalog.at(-1)?.trigger, "paid")
    assert.equal(schemaField(eventCatalog()[0].schema, "contact.properties.plan"), undefined)
  })
})
