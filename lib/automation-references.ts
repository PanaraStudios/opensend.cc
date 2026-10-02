import type {
  AutomationRule,
  AutomationStep,
  AutomationStepType,
} from "./dashboard/types"
import {
  catalogEvent,
  flattenSchema,
  schemaField,
  CONTACT_SCHEMA,
  type CatalogEvent,
  type EventField,
} from "./event-catalog"
import { field, object } from "../packages/sdk/src/events/catalog"
export type ReferenceScope = {
  trigger?: Record<string, unknown>
  event?: Record<string, unknown>
  contact: Record<string, unknown>
  steps?: Record<string, Record<string, unknown>>
}
const forbidden = new Set(["__proto__", "prototype", "constructor"])
export function referenceValue(scope: ReferenceScope, path: string): unknown {
  const keys = path
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
  if (keys.some((key) => forbidden.has(key))) return undefined
  return keys.reduce<unknown>(
    (value, key) =>
      value !== null && typeof value === "object" && Object.hasOwn(value, key)
        ? (value as Record<string, unknown>)[key]
        : undefined,
    scope
  )
}
const tokens = /(?<!\{)\{\{\s*([^{}]+?)\s*\}\}(?!\})/g
export function references(value: string): string[] {
  return [...value.matchAll(tokens)].map((match) => match[1].trim())
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!
  )
}
const display = (value: unknown) =>
  value == null
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value)
/** Whole tokens retain their type; mixed text is safely interpolated. */
export function resolveReference(
  value: string,
  scope: ReferenceScope,
  options: { fallback?: unknown; html?: boolean; legacy?: boolean } = {}
): unknown {
  const full = value
    .trim()
    .match(
      /^\{\{\s*((?:trigger|steps|contact|event)\.[A-Za-z0-9_.\[\]-]+)\s*\}\}$/
    )
  if (full && !options.html)
    return referenceValue(scope, full[1]) ?? options.fallback ?? ""
  if (options.legacy && /^(event|contact)\./.test(value.trim()))
    return referenceValue(scope, value.trim()) ?? value
  return value.replace(tokens, (_, path: string) => {
    const text = display(referenceValue(scope, path) ?? options.fallback)
    return options.html ? escapeHtml(text) : text
  })
}
export function resolveText(
  value: string,
  scope: ReferenceScope,
  options: Parameters<typeof resolveReference>[2] = {}
): string {
  return display(resolveReference(value, scope, options))
}
export const contactSnapshot = (contact: {
  _id: string
  email?: string
  phone?: string
  firstName: string
  lastName: string
  unsubscribed: boolean
  properties: Record<string, string>
}) => ({
  id: contact._id,
  email: contact.email ?? "",
  phone: contact.phone ?? "",
  first_name: contact.firstName,
  last_name: contact.lastName,
  unsubscribed: contact.unsubscribed,
  properties: contact.properties,
})
const messageOutput = object({
  message_id: field("string", "Queued message id", "msg_123", {
    optional: true,
  }),
  status: field("enum", "Send status", "queued", {
    values: ["queued", "skipped"],
    optional: true,
  }),
  reason: field("string", "Skip reason", "window_closed", { optional: true }),
})
export function stepOutputSchema(
  step: AutomationStep,
  catalog: readonly CatalogEvent[],
  contact = CONTACT_SCHEMA
): EventField {
  switch (step.type) {
    case "send_email":
      return object({
        ...messageOutput.fields,
        email_id: field("string", "Email id", "email_123", { optional: true }),
        to: field("string", "Recipient", "ada@example.com", { optional: true }),
      })
    case "send_whatsapp":
    case "send_messenger":
    case "send_instagram":
      return messageOutput
    case "wait_for_event":
      return object({
        ...catalogEvent(catalog, step.eventName)?.schema.fields,
        payload: catalogEvent(catalog, step.eventName)?.schema ?? object({}),
        event_received: field("boolean", "Whether the event arrived", true),
      })
    case "condition":
      return object({
        condition_met: field("boolean", "Condition result", true),
        branch: field("enum", "Selected branch", "met", {
          values: ["met", "notMet"],
        }),
      })
    case "contact_update":
      return object({ contact })
    case "contact_delete":
      return object({ deleted: field("boolean", "Contact deleted", true) })
    case "add_to_segment":
      return object({
        segment_id: field("string", "Joined segment", "segment_123"),
      })
    case "delay":
      return object({
        until: field("date", "Resume time", "2026-10-02T12:00:00.000Z"),
      })
  }
}
export function previousSteps(
  steps: readonly AutomationStep[],
  key: string,
  before: AutomationStep[] = []
): AutomationStep[] | undefined {
  const seen = [...before]
  for (const step of steps) {
    if (step.key === key) return seen
    if (step.type === "condition" || step.type === "wait_for_event") {
      const branches =
        step.type === "condition"
          ? [step.met, step.notMet]
          : [step.received, step.timedOut]
      for (const branch of branches) {
        const found = previousSteps(branch, key, [...seen, step])
        if (found) return found
      }
    }
    seen.push(step)
  }
}
export type VariableOption = {
  path: string
  group: string
  label: string
  field: EventField
}
export function variableOptions(
  trigger: string,
  steps: readonly AutomationStep[],
  key: string,
  catalog: readonly CatalogEvent[],
  contact = CONTACT_SCHEMA
): VariableOption[] {
  const sources = [
    {
      prefix: "trigger",
      group: "Trigger",
      schema: catalogEvent(catalog, trigger)?.schema ?? object({}),
    },
    ...(previousSteps(steps, key) ?? []).map((step) => ({
      prefix: `steps.${step.key}`,
      group: `${step.type.replaceAll("_", " ")} (${step.key})`,
      schema: stepOutputSchema(step, catalog, contact),
    })),
    { prefix: "contact", group: "Contact", schema: contact },
  ]
  return sources.flatMap((source) =>
    flattenSchema(source.schema).map(({ path, field }) => ({
      path: `${source.prefix}.${path}`,
      group: source.group,
      label: `${source.group} › ${path
        .split(".")
        .map((p) => p.replaceAll("_", " "))
        .join(" › ")}`,
      field,
    }))
  )
}
function ownStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (value && typeof value === "object")
    return Object.values(value).flatMap(ownStrings)
  return []
}
export function referenceErrors(
  trigger: string,
  steps: readonly AutomationStep[],
  catalog: readonly CatalogEvent[],
  contact = CONTACT_SCHEMA,
  filters: readonly AutomationRule[] = []
): string[] {
  const errors: string[] = []
  const validate = (
    key: string,
    values: string[],
    rules: readonly AutomationRule[],
    before: readonly AutomationStep[]
  ) => {
    const schemas = {
      trigger: catalogEvent(catalog, trigger)?.schema,
      event: catalogEvent(catalog, trigger)?.schema,
      contact,
      steps: object(
        Object.fromEntries(
          before.map((s) => [s.key, stepOutputSchema(s, catalog, contact)])
        )
      ),
    }
    const lookup = (path: string) => {
      const [scope, ...rest] = path.split(".")
      return schemaField(schemas[scope as keyof typeof schemas], rest.join("."))
    }
    for (const value of values)
      for (const path of references(value))
        if (!lookup(path))
          errors.push(`${key}: Unknown or unreachable reference {{${path}}}`)
    for (const rule of rules) {
      const path = references(rule.field)[0] ?? rule.field
      const type = lookup(path)?.type
      if (!type) {
        const event = catalogEvent(catalog, trigger)
        const legacyUntyped =
          /^(event|trigger)\./.test(rule.field) &&
          (!event ||
            (event.group === "Custom events" &&
              !Object.keys(event.schema.fields ?? {}).length))
        if (rule.field && !legacyUntyped)
          errors.push(`${key}: Unknown condition field ${rule.field}`)
        continue
      }
      if (["exists", "is_empty"].includes(rule.operator)) continue
      const expected =
        references(rule.value).length === 1 &&
        rule.value.trim().startsWith("{{")
          ? lookup(references(rule.value)[0])?.type
          : undefined
      if (expected && expected !== type)
        errors.push(
          `${key}: ${path} is ${type}, but the comparison is ${expected}`
        )
      if (
        ["contains", "starts_with", "ends_with"].includes(rule.operator) &&
        !["string", "enum"].includes(type)
      )
        errors.push(`${key}: ${rule.operator} requires a string field`)
      if (
        ["gt", "gte", "lt", "lte"].includes(rule.operator) &&
        !["number", "date"].includes(type)
      )
        errors.push(`${key}: ${rule.operator} requires a number or date field`)
      if (
        !expected &&
        !references(rule.value).length &&
        ((type === "number" && !Number.isFinite(Number(rule.value))) ||
          (type === "boolean" && !["true", "false"].includes(rule.value)) ||
          (type === "date" && Number.isNaN(Date.parse(rule.value))))
      )
        errors.push(`${key}: ${path} requires a ${type} value`)
    }
  }
  validate(
    "Trigger",
    filters.flatMap((r) => [r.field, r.value]),
    filters,
    []
  )
  const walk = (nodes: readonly AutomationStep[], before: AutomationStep[]) => {
    const seen = [...before]
    for (const step of nodes) {
      const { key, type, ...config } = step
      const shallow = Object.fromEntries(
        Object.entries(config).filter(
          ([k]) => !["met", "notMet", "received", "timedOut"].includes(k)
        )
      )
      validate(
        key,
        ownStrings(shallow),
        type === "condition" ? step.rules : [],
        seen
      )
      if (type === "condition") {
        walk(step.met, [...seen, step])
        walk(step.notMet, [...seen, step])
      }
      if (type === "wait_for_event") {
        walk(step.received, [...seen, step])
        walk(step.timedOut, [...seen, step])
      }
      seen.push(step)
    }
  }
  walk(steps, [])
  return [...new Set(errors)]
}
export const STEP_OUTPUT_TYPES: readonly AutomationStepType[] = [
  "send_email",
  "send_whatsapp",
  "send_messenger",
  "send_instagram",
  "wait_for_event",
  "contact_update",
  "condition",
  "delay",
  "contact_delete",
  "add_to_segment",
]
