import { flattenSteps } from "./automation"
import type { AutomationStep } from "./types"

/** The graph supports 100 steps, plus its trigger. */
export const CATALOG_SELECTED_LIMIT = 101
export function automationCatalogNames(
  trigger: string,
  steps: AutomationStep[]
) {
  return [
    ...new Set([
      trigger,
      ...flattenSteps(steps).flatMap((step) =>
        step.type === "wait_for_event" ? [step.eventName] : []
      ),
    ]),
  ]
    .filter(Boolean)
    .slice(0, CATALOG_SELECTED_LIMIT)
}
