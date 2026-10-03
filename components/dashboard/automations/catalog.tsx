"use client"

import type {
  Automation,
  AutomationStep,
  AutomationStepType,
} from "@/lib/dashboard/types"
import {
  STEP_GROUPS,
  STEP_LABELS,
  stepBranches,
  stepSummary,
  stepTitle,
} from "@/lib/dashboard/automation"
import type { FlowCatalog } from "../flows/catalog"
import { STEP_ICONS } from "./shared"
import { StepBody, StepCard } from "./step-cards"

type AutomationContext = {
  automation: Automation
  locked: boolean
  stepContext: Parameters<typeof stepSummary>[1] | undefined
  onChange: (step: AutomationStep) => void
  onRemove: (step: AutomationStep) => void
}
const kinds = STEP_GROUPS.flatMap((group) => group.types)
type Entry = FlowCatalog<
  AutomationStep,
  AutomationContext,
  AutomationStepType
>["entries"][AutomationStepType]
function entry(type: AutomationStepType): Entry {
  return {
    icon: STEP_ICONS[type],
    label: STEP_LABELS[type],
    title: stepTitle,
    summary: (node, context) =>
      context.stepContext ? stepSummary(node, context.stepContext) : null,
    branches: stepBranches,
    addAfter: () => kinds,
    Editor: ({ node, context }) => (
      <StepBody
        automation={context.automation}
        step={node}
        onChange={context.onChange}
      />
    ),
    Card: ({ node, context, selected, onSelect, editor }) => (
      <StepCard
        automation={context.automation}
        step={node}
        selected={selected}
        locked={context.locked}
        onSelect={onSelect}
        onChange={context.onChange}
        onRemove={() => context.onRemove(node)}
        editor={editor}
      />
    ),
  }
}
export const automationCatalog: FlowCatalog<
  AutomationStep,
  AutomationContext,
  AutomationStepType
> = {
  kind: (node) => node.type,
  entries: {
    condition: entry("condition"),
    delay: entry("delay"),
    wait_for_event: entry("wait_for_event"),
    send_email: entry("send_email"),
    send_whatsapp: entry("send_whatsapp"),
    send_instagram: entry("send_instagram"),
    send_messenger: entry("send_messenger"),
    place_call: entry("place_call"),
    contact_update: entry("contact_update"),
    contact_delete: entry("contact_delete"),
    add_to_segment: entry("add_to_segment"),
  },
}
