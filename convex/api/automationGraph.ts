import type { AutomationStep, AutomationRule } from "../../lib/dashboard/types"
import { AUTOMATION_RULE_OPERATORS } from "../../lib/dashboard/types"
import { readGraph } from "../automationDefinition"
import { invalid } from "./caller"
import { objectBody, stringField } from "./route"

const text = (o: Record<string, unknown>, key: string) =>
  stringField(o, key, true)!
type WireStep = { key: string; type: string; config: Record<string, unknown> }
type Connection = { from: string; to: string; type: string }
const valueText = (value: unknown): string => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value)
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ref = (value as Record<string, unknown>).var
    if (typeof ref === "string" && /^(event|contact)\./.test(ref)) return ref
  }
  throw invalid(
    "Unsupported automation value; use a scalar or an event/contact variable."
  )
}
function rule(value: unknown): AutomationRule {
  const r = objectBody(value)
  if (r.type !== "rule")
    throw invalid(
      "Unsupported condition step: nested rule groups are not supported."
    )
  const operator = text(r, "operator")
  if (!(AUTOMATION_RULE_OPERATORS as readonly string[]).includes(operator))
    throw invalid(`Unsupported condition operator: ${operator}.`)
  if (
    ["gt", "gte", "lt", "lte"].includes(operator) &&
    (typeof r.value !== "number" || !Number.isFinite(r.value))
  )
    throw invalid("Numeric condition operators require a numeric value.")
  if (
    ["contains", "starts_with", "ends_with"].includes(operator) &&
    typeof r.value !== "string"
  )
    throw invalid("Text condition operators require a string value.")
  return {
    field: text(r, "field"),
    operator: operator as AutomationRule["operator"],
    value: ["exists", "is_empty"].includes(operator) ? "" : valueText(r.value),
  }
}

/** The runtime executes a bounded tree. Reject joins/cycles instead of executing a node twice. */
export function parseAutomationGraph(
  stepsValue: unknown,
  connectionsValue: unknown
) {
  if (
    !Array.isArray(stepsValue) ||
    !stepsValue.length ||
    stepsValue.length > 101
  )
    throw invalid("Automations support a trigger and at most 100 steps.")
  if (!Array.isArray(connectionsValue) || connectionsValue.length > 200)
    throw invalid("Invalid automation connections.")
  const steps: WireStep[] = stepsValue.map((value) => {
    const row = objectBody(value)
    if (row.config === undefined || row.config === null)
      throw invalid("Every automation step requires a config object.")
    if (
      ![
        "trigger",
        "delay",
        "condition",
        "wait_for_event",
        "send_email",
        "contact_update",
        "contact_delete",
        "add_to_segment",
      ].includes(String(row.type))
    )
      throw invalid(`Unsupported automation step type: ${String(row.type)}.`)
    return {
      key: text(row, "key"),
      type: text(row, "type"),
      config: objectBody(row.config),
    }
  })
  const byKey = new Map(steps.map((step) => [step.key, step]))
  if (
    byKey.size !== steps.length ||
    steps.some((s) => !s.key || s.key.length > 128)
  )
    throw invalid(
      "Step keys must be unique nonempty strings of at most 128 characters."
    )
  const triggers = steps.filter((s) => s.type === "trigger")
  if (triggers.length !== 1)
    throw invalid("An automation must have exactly one trigger step.")
  const trigger = triggers[0]
  if (steps.some((s) => s.key === "start" && s !== trigger))
    throw invalid("The start key is reserved for the trigger.")
  const connections: Connection[] = connectionsValue.map((value) => {
    const c = objectBody(value)
    return {
      from: text(c, "from"),
      to: text(c, "to"),
      type: stringField(c, "type") ?? "default",
    }
  })
  const outgoing = new Map<string, Map<string, string>>()
  const incoming = new Set<string>()
  for (const c of connections) {
    const source = byKey.get(c.from)
    if (!source || !byKey.has(c.to) || c.to === trigger.key)
      throw invalid(
        "Connections must reference existing steps and cannot target the trigger."
      )
    const allowed =
      source.type === "condition"
        ? ["condition_met", "condition_not_met"]
        : source.type === "wait_for_event"
          ? ["event_received", "timeout"]
          : ["default"]
    if (!allowed.includes(c.type))
      throw invalid(`Invalid connection type for ${source.type}: ${c.type}.`)
    const edges = outgoing.get(c.from) ?? new Map<string, string>()
    if (edges.has(c.type) || incoming.has(c.to))
      throw invalid(
        "Unsupported automation graph: branching requires condition/wait steps; joins are not supported."
      )
    incoming.add(c.to)
    edges.set(c.type, c.to)
    outgoing.set(c.from, edges)
  }
  const seen = new Set([trigger.key])
  const walk = (key: string | undefined, depth = 0): AutomationStep[] => {
    if (key === undefined) return []
    if (seen.has(key) || depth > 100)
      throw invalid("Automation graph contains a cycle or is too deep.")
    seen.add(key)
    const s = byKey.get(key)!
    const c = s.config
    const next = outgoing.get(key)
    let node: AutomationStep
    switch (s.type) {
      case "delay":
        node = { key, type: s.type, duration: text(c, "duration") }
        break
      case "contact_delete":
        node = { key, type: s.type }
        break
      case "add_to_segment":
        node = { key, type: s.type, segmentId: text(c, "segment_id") }
        break
      case "send_email": {
        if (c.subject !== undefined)
          throw invalid("Unsupported send_email step option: subject override.")
        const template = objectBody(c.template)
        const variables = Object.fromEntries(
          Object.entries(objectBody(template.variables)).map(([k, value]) => [
            k,
            valueText(value),
          ])
        )
        node = {
          key,
          type: s.type,
          templateId: text(template, "id"),
          variables,
          from: stringField(c, "from") ?? "",
          replyTo: stringField(c, "reply_to") ?? "",
        }
        break
      }
      case "wait_for_event":
        if (c.filter_rule !== undefined)
          throw invalid("Unsupported wait_for_event step option: filter_rule.")
        node = {
          key,
          type: s.type,
          eventName: text(c, "event_name"),
          timeout: stringField(c, "timeout") ?? "",
          received: walk(next?.get("event_received"), depth + 1),
          timedOut: walk(next?.get("timeout"), depth + 1),
        }
        break
      case "condition": {
        const match = c.type === "or" ? "or" : "and"
        const rules =
          c.type === "rule"
            ? [rule(c)]
            : (c.type === "and" || c.type === "or") && Array.isArray(c.rules)
              ? c.rules.map(rule)
              : null
        if (!rules) throw invalid("Invalid condition step rule tree.")
        node = {
          key,
          type: s.type,
          match,
          rules,
          met: walk(next?.get("condition_met"), depth + 1),
          notMet: walk(next?.get("condition_not_met"), depth + 1),
        }
        break
      }
      case "contact_update": {
        const entries = Object.entries(c).filter(([k]) => k !== "properties")
        if (
          entries.some(
            ([k]) => !["first_name", "last_name", "unsubscribed"].includes(k)
          )
        )
          throw invalid("Invalid contact_update step field.")
        entries.push(...Object.entries(objectBody(c.properties)))
        node = {
          key,
          type: s.type,
          fields: entries.map(([property, value]) => ({
            property,
            action: value === null ? "clear" : "change",
            value: value === null ? "" : valueText(value),
          })),
        }
        break
      }
      default:
        throw invalid(`Unsupported automation step type: ${s.type}.`)
    }
    return [node, ...walk(next?.get("default"), depth + 1)]
  }
  const graph = JSON.stringify(walk(outgoing.get(trigger.key)?.get("default")))
  if (seen.size !== steps.length)
    throw invalid("Every automation step must be reachable from the trigger.")
  readGraph(graph)
  if (
    new TextEncoder().encode(JSON.stringify({ steps, connections }))
      .byteLength >
    64 * 1024
  )
    throw invalid("Automation definitions support at most 64 KiB.")
  return {
    trigger: text(trigger.config, "event_name"),
    graph,
    apiDefinition: JSON.stringify({ steps, connections }),
  }
}

export function automationGraph(row: {
  trigger: string
  graph: string
  apiDefinition?: string
}): { steps: WireStep[]; connections: Connection[] } {
  if (row.apiDefinition) return JSON.parse(row.apiDefinition)
  const steps: WireStep[] = [
    { key: "start", type: "trigger", config: { event_name: row.trigger } },
  ]
  const connections: Connection[] = []
  const walk = (
    nodes: AutomationStep[],
    incoming: { from: string; type: string }[]
  ): { from: string; type: string }[] => {
    let pending = incoming
    for (const node of nodes) {
      for (const edge of pending) connections.push({ ...edge, to: node.key })
      let config: Record<string, unknown>
      switch (node.type) {
        case "delay":
          config = { duration: node.duration }
          break
        case "send_email":
          config = {
            template: {
              id: node.templateId,
              variables: Object.fromEntries(
                Object.entries(node.variables).map(([key, value]) => [
                  key,
                  /^(event|contact)\./.test(value.trim())
                    ? { var: value.trim() }
                    : value,
                ])
              ),
            },
            ...(node.from ? { from: node.from } : {}),
            ...(node.replyTo ? { reply_to: node.replyTo } : {}),
          }
          break
        case "contact_delete":
          config = {}
          break
        case "add_to_segment":
          config = { segment_id: node.segmentId }
          break
        case "condition":
          config = {
            type: node.match,
            rules: node.rules.map((r) => ({
              type: "rule",
              field: r.field,
              operator: r.operator,
              ...(["exists", "is_empty"].includes(r.operator)
                ? {}
                : {
                    value:
                      ["gt", "gte", "lt", "lte"].includes(r.operator) &&
                      Number.isFinite(Number(r.value))
                        ? Number(r.value)
                        : r.value,
                  }),
            })),
          }
          break
        case "wait_for_event":
          config = {
            event_name: node.eventName,
            ...(node.timeout ? { timeout: node.timeout } : {}),
          }
          break
        case "contact_update": {
          config = { properties: {} }
          for (const f of node.fields) {
            const target = ["first_name", "last_name", "unsubscribed"].includes(
              f.property
            )
              ? config
              : (config.properties as Record<string, unknown>)
            target[f.property] =
              f.action === "clear"
                ? null
                : /^(event|contact)\./.test(f.value)
                  ? { var: f.value }
                  : f.property === "unsubscribed"
                    ? f.value === "true"
                    : f.value
          }
        }
      }
      steps.push({ key: node.key, type: node.type, config })
      if (node.type === "condition") {
        pending = [
          ...walk(node.met, [{ from: node.key, type: "condition_met" }]),
          ...walk(node.notMet, [{ from: node.key, type: "condition_not_met" }]),
        ]
      } else if (node.type === "wait_for_event") {
        pending = [
          ...walk(node.received, [{ from: node.key, type: "event_received" }]),
          ...walk(node.timedOut, [{ from: node.key, type: "timeout" }]),
        ]
      } else pending = [{ from: node.key, type: "default" }]
    }
    return pending
  }
  walk(readGraph(row.graph), [{ from: "start", type: "default" }])
  return { steps, connections }
}
