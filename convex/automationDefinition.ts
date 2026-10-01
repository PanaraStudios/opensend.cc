import { ConvexError } from "convex/values"
import type { AutomationStep } from "../lib/dashboard/types"
import { variableSourcesError } from "../lib/meta/variables"
import { AUTOMATION_RULE_OPERATORS } from "../lib/dashboard/types"

export const MAX_STEPS = 100
export const MAX_GRAPH_BYTES = 64 * 1024
const invalid = () => {
  throw new ConvexError("Invalid automation definition")
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid()
  return value as Record<string, unknown>
}
const strings = (value: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) if (typeof value[key] !== "string") invalid()
}

/** JSON keeps the recursive graph out of Convex's validator nesting limit.
    Validate every node before storing it, including drafts with blank fields. */
export function readGraph(graph: string): AutomationStep[] {
  if (new TextEncoder().encode(graph).length > MAX_GRAPH_BYTES) invalid()
  let parsed: unknown
  try {
    parsed = JSON.parse(graph)
  } catch {
    return invalid()
  }
  const keys = new Set<string>()
  const walk = (value: unknown, depth: number) => {
    if (!Array.isArray(value) || depth > 12) return invalid()
    for (const item of value) {
      const step = object(item)
      strings(step, "key", "type")
      const key = step.key as string
      if (!key || key === "start" || key.length > 128 || keys.has(key))
        invalid()
      keys.add(key)
      if (keys.size > MAX_STEPS) invalid()
      switch (step.type) {
        case "condition":
          if (step.match !== "and" && step.match !== "or") invalid()
          if (!Array.isArray(step.rules) || step.rules.length > 50)
            return invalid()
          for (const value of step.rules) {
            const rule = object(value)
            strings(rule, "field", "operator", "value")
            if (
              !(AUTOMATION_RULE_OPERATORS as readonly unknown[]).includes(
                rule.operator
              )
            )
              invalid()
          }
          walk(step.met, depth + 1)
          walk(step.notMet, depth + 1)
          break
        case "wait_for_event":
          strings(step, "eventName", "timeout")
          walk(step.received, depth + 1)
          walk(step.timedOut, depth + 1)
          break
        case "delay":
          strings(step, "duration")
          break
        case "send_whatsapp":
          strings(step, "accountId")
          if (step.mode !== "template" && step.mode !== "text") invalid()
          if (step.mode === "template") strings(step, "templateId")
          if (step.mode === "text") strings(step, "text")
          if (variableSourcesError(step.variables)) invalid()
          break
        case "send_email":
          strings(step, "templateId", "from", "replyTo")
          if (
            Object.values(object(step.variables)).some(
              (v) => typeof v !== "string"
            )
          )
            invalid()
          break
        case "contact_update":
          if (!Array.isArray(step.fields) || step.fields.length > 100)
            return invalid()
          for (const value of step.fields) {
            const field = object(value)
            strings(field, "property", "value")
            if (field.action !== "clear" && field.action !== "change") invalid()
            if (field.property === "email") invalid()
          }
          break
        case "contact_delete":
          break
        case "add_to_segment":
          strings(step, "segmentId")
          break
        default:
          invalid()
      }
    }
  }
  walk(parsed, 0)
  return parsed as AutomationStep[]
}
