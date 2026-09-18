import { RESERVED_PROPERTY_KEYS } from "./contacts"
import { pluralize, rate } from "./format"
import { uniqueName } from "./slug"
import type {
  Automation,
  AutomationEvent,
  AutomationRule,
  AutomationRuleOperator,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunStep,
  AutomationStep,
  AutomationStepType,
  Contact,
  EmailTemplate,
  Segment,
} from "./types"

/* A workflow is a tree: a trigger, then steps, two of which branch. Everything
   here is pure so the builder, the store and the run simulation agree on what
   a workflow is. */

export const UNTITLED_AUTOMATION = "Untitled automation"

export const STEP_LABELS: Record<AutomationStepType, string> = {
  condition: "Condition",
  delay: "Delay",
  wait_for_event: "Wait for event",
  send_email: "Send email",
  contact_update: "Update contact",
  contact_delete: "Delete contact",
  add_to_segment: "Add to segment",
}

/** The step types as the "add step" menu lists them. */
export const STEP_GROUPS: readonly {
  label: string
  types: readonly AutomationStepType[]
}[] = [
  { label: "Messages", types: ["send_email"] },
  { label: "Flow control", types: ["condition", "delay", "wait_for_event"] },
  {
    label: "Audience",
    types: ["contact_update", "contact_delete", "add_to_segment"],
  },
]

export const RULE_OPERATOR_LABELS: Record<AutomationRuleOperator, string> = {
  eq: "is equal to",
  neq: "is not equal to",
  gt: "is greater than",
  gte: "is greater than or equal to",
  lt: "is less than",
  lte: "is less than or equal to",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  exists: "exists",
  is_empty: "is empty",
}

/** `exists` and `is_empty` look at the field alone. */
export function operatorTakesValue(operator: AutomationRuleOperator): boolean {
  return operator !== "exists" && operator !== "is_empty"
}

/* --------------------------------------------------------------- the tree */

type StepBranch = { id: string; label: string; steps: AutomationStep[] }

/** The paths out of a step that branches, in the order they are drawn. */
export function stepBranches(step: AutomationStep): StepBranch[] {
  if (step.type === "condition") {
    return [
      { id: "met", label: "True", steps: step.met },
      { id: "notMet", label: "False", steps: step.notMet },
    ]
  }
  if (step.type === "wait_for_event") {
    return [
      { id: "received", label: "Event received", steps: step.received },
      /* The path taken when the wait runs out is named by how long that is. */
      {
        id: "timedOut",
        label: formatDuration(step.timeout) ?? "Timed out",
        steps: step.timedOut,
      },
    ]
  }
  return []
}

function withBranch(
  step: AutomationStep,
  branch: string,
  steps: AutomationStep[]
): AutomationStep {
  return { ...step, [branch]: steps } as AutomationStep
}

/** Every step, parents before their branches. */
export function flattenSteps(
  steps: readonly AutomationStep[]
): AutomationStep[] {
  return steps.flatMap((step) => [
    step,
    ...stepBranches(step).flatMap((branch) => flattenSteps(branch.steps)),
  ])
}

export function findStep(
  steps: readonly AutomationStep[],
  key: string
): AutomationStep | undefined {
  return flattenSteps(steps).find((step) => step.key === key)
}

function mapSteps(
  steps: readonly AutomationStep[],
  visit: (list: AutomationStep[]) => AutomationStep[]
): AutomationStep[] {
  return visit(
    steps.map((step) =>
      stepBranches(step).reduce(
        (next, branch) =>
          withBranch(next, branch.id, mapSteps(branch.steps, visit)),
        step
      )
    )
  )
}

export function replaceStep(
  steps: readonly AutomationStep[],
  next: AutomationStep
): AutomationStep[] {
  return mapSteps(steps, (list) =>
    list.map((step) => (step.key === next.key ? next : step))
  )
}

/** Removes the step and, if it branches, everything on its paths. */
export function removeStep(
  steps: readonly AutomationStep[],
  key: string
): AutomationStep[] {
  return mapSteps(steps, (list) => list.filter((step) => step.key !== key))
}

/** Where a new step goes: a place in the root list, or in one path of a
    branching step. */
export type StepSlot = {
  parent: { key: string; branch: string } | null
  index: number
}

export function insertStep(
  steps: readonly AutomationStep[],
  slot: StepSlot,
  step: AutomationStep
): AutomationStep[] {
  const { parent } = slot
  if (!parent) return placeStep(steps, slot.index, step)
  const owner = findStep(steps, parent.key)
  const branch = owner
    ? stepBranches(owner).find((item) => item.id === parent.branch)
    : undefined
  if (!owner || !branch) return [...steps]
  return replaceStep(
    steps,
    withBranch(owner, branch.id, placeStep(branch.steps, slot.index, step))
  )
}

/* Nothing follows a step that branches, so what came after the slot carries
   on down the new step's first path. */
function placeStep(
  list: readonly AutomationStep[],
  index: number,
  step: AutomationStep
): AutomationStep[] {
  const [first] = stepBranches(step)
  if (!first) return list.toSpliced(index, 0, step)
  return [
    ...list.slice(0, index),
    withBranch(step, first.id, [...first.steps, ...list.slice(index)]),
  ]
}

/** A blank step of a type, keyed so no two steps of a workflow collide. */
export function newStep(
  type: AutomationStepType,
  steps: readonly AutomationStep[]
): AutomationStep {
  const key = uniqueName(
    type,
    flattenSteps(steps).map((step) => step.key),
    "_"
  )
  switch (type) {
    case "condition":
      return {
        key,
        type,
        match: "and",
        rules: [],
        met: [],
        notMet: [],
      }
    case "delay":
      return { key, type, duration: "" }
    case "wait_for_event":
      return {
        key,
        type,
        eventName: "",
        timeout: "1 week",
        received: [],
        timedOut: [],
      }
    case "send_email":
      return {
        key,
        type,
        templateId: "",
        from: "",
        replyTo: "",
        variables: {},
      }
    case "contact_update":
      return { key, type, fields: [] }
    case "contact_delete":
      return { key, type }
    case "add_to_segment":
      return { key, type, segmentId: "" }
  }
}

/** A copy with fresh ids. Steps keep their keys: they are unique within one
    workflow, and the copy is its own workflow. */
export function duplicatedAutomation(
  source: Automation,
  id: string,
  now: number
): Automation {
  return {
    ...source,
    id,
    name: `${source.name} copy`,
    status: "disabled",
    createdAt: now,
  }
}

/* -------------------------------------------------------------- durations */

const UNIT_MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
}

const UNIT_NAMES: Record<string, keyof typeof UNIT_MS> = {
  m: "minute",
  min: "minute",
  mins: "minute",
  minute: "minute",
  minutes: "minute",
  h: "hour",
  hr: "hour",
  hrs: "hour",
  hour: "hour",
  hours: "hour",
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  week: "week",
  weeks: "week",
}

const MAX_DURATION_MS = 30 * UNIT_MS.day

/** "10 minutes", "2h", "1h 30m", "1 week" as milliseconds. */
export function parseDuration(text: string): number | null {
  const clean = text.trim().toLowerCase()
  if (!/^(\d+\s*[a-z]+\s*)+$/.test(clean)) return null
  const parts = clean.matchAll(/(\d+)\s*([a-z]+)/g)
  let total = 0
  for (const [, amount, unit] of parts) {
    const name = UNIT_NAMES[unit!]
    if (!name) return null
    total += Number(amount) * UNIT_MS[name]
  }
  return total > 0 ? total : null
}

/** A duration in its largest whole unit: "1h 30m" reads "90 minutes". */
export function formatDuration(text: string): string | null {
  const total = parseDuration(text)
  if (total === null) return null
  const unit =
    (["week", "day", "hour"] as const).find(
      (name) => total % UNIT_MS[name] === 0
    ) ?? "minute"
  const count = Math.round(total / UNIT_MS[unit])
  return pluralize(count, unit)
}

export function durationError(text: string): string | null {
  const total = parseDuration(text)
  if (total === null) return 'Enter a duration like "10 minutes" or "1h 30m"'
  if (total > MAX_DURATION_MS) return "The longest wait is 30 days"
  return null
}

/* ------------------------------------------------------------ validation */

export const RESERVED_EVENT_PREFIX = "opensend:"

export function eventNameError(
  name: string,
  taken: readonly string[] = []
): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "Enter an event name"
  if (trimmed.toLowerCase().startsWith(RESERVED_EVENT_PREFIX)) {
    return `Names starting with ${RESERVED_EVENT_PREFIX} are reserved for system events`
  }
  if (taken.includes(trimmed)) return "An event with this name already exists"
  return null
}

/** The automations an event starts or continues. */
export function eventListeners(
  automations: readonly Pick<Automation, "id" | "trigger" | "steps">[],
  name: string
): Pick<Automation, "id" | "trigger" | "steps">[] {
  return automations.filter(
    (item) =>
      item.trigger === name ||
      flattenSteps(item.steps).some(
        (step) => step.type === "wait_for_event" && step.eventName === name
      )
  )
}

export type StepContext = {
  templates: readonly Pick<EmailTemplate, "id" | "name" | "status">[]
  segments: readonly Pick<Segment, "id" | "name">[]
}

/** A rule's field, apart: `contact.email` is `email` of the contact. */
export function splitField(field: string): {
  scope: "event" | "contact"
  property: string
} {
  const contact = field.startsWith("contact.")
  return {
    scope: contact ? "contact" : "event",
    property: field.replace(/^(event|contact)\./, ""),
  }
}

/** `event.plan is equal to "team"`, as a condition reads on its card. */
export function ruleText(rule: AutomationRule): string {
  return [
    splitField(rule.field).property,
    RULE_OPERATOR_LABELS[rule.operator],
    operatorTakesValue(rule.operator) ? JSON.stringify(rule.value) : "",
  ]
    .filter(Boolean)
    .join(" ")
}

export function ruleError(rule: AutomationRule): string | null {
  if (!/^(event|contact)\.[A-Za-z0-9_.]+$/.test(rule.field.trim())) {
    return "Choose a property"
  }
  if (operatorTakesValue(rule.operator) && !rule.value.trim()) {
    return "Enter a value to compare with"
  }
  return null
}

const CONTACT_FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  unsubscribed: "Unsubscribed",
}

/** The contact's own fields, as rules and references name them. */
export const CONTACT_FIELDS: readonly string[] = RESERVED_PROPERTY_KEYS

/** The ones an "update contact" step may change: the address is who the
    contact is. */
export const UPDATABLE_CONTACT_FIELDS = CONTACT_FIELDS.filter(
  (key) => key !== "email"
)

/** A contact field by the name people know it by. */
export function contactFieldLabel(property: string): string {
  return CONTACT_FIELD_LABELS[property] ?? property
}

/** What is left to do before a step can run; empty when it is ready. */
export function stepTasks(
  step: AutomationStep,
  context: StepContext
): string[] {
  switch (step.type) {
    case "condition":
      return step.rules.length === 0 || step.rules.some(ruleError)
        ? ["Add a condition"]
        : []
    case "delay":
      return step.duration.trim()
        ? [durationError(step.duration)].flatMap((error) => error ?? [])
        : ["Set a delay"]
    case "wait_for_event":
      return [
        eventNameError(step.eventName) ? "Set event" : null,
        durationError(step.timeout),
      ].flatMap((task) => task ?? [])
    case "send_email": {
      const template = context.templates.find(
        (item) => item.id === step.templateId
      )
      if (!template) return ["Select an email template"]
      return template.status === "published"
        ? []
        : ["Publish the email template"]
    }
    case "contact_update":
      return step.fields.length === 0 ? ["Add a field to update"] : []
    case "contact_delete":
      return []
    case "add_to_segment":
      return context.segments.some((item) => item.id === step.segmentId)
        ? []
        : ["Select a segment"]
  }
}

/** What stops a step from running, or null. */
export function stepProblem(
  step: AutomationStep,
  context: StepContext
): string | null {
  return stepTasks(step, context)[0] ?? null
}

export type AutomationTask = {
  key: string
  type: AutomationStepType | "trigger"
  title: string
  tasks: string[]
}

export const TRIGGER_KEY = "start"

/** Everything left to do before the automation can start, step by step. */
export function automationTasks(
  automation: Pick<Automation, "trigger" | "steps">,
  context: StepContext
): AutomationTask[] {
  const steps = flattenSteps(automation.steps)
  return [
    {
      key: TRIGGER_KEY,
      type: "trigger" as const,
      title: "Custom event",
      tasks: [
        ...(eventNameError(automation.trigger) ? ["Set event"] : []),
        ...(steps.length === 0 ? ["Add a step"] : []),
      ],
    },
    ...steps.map((step) => ({
      key: step.key,
      type: step.type,
      title: STEP_LABELS[step.type],
      tasks: stepTasks(step, context),
    })),
  ].filter((item) => item.tasks.length > 0)
}

/** The name on a step's card. Some steps are named by what they are set to:
    a delay by how long it is, an update by the fields it changes. */
export function stepTitle(step: AutomationStep): string {
  if (step.type === "delay") {
    return formatDuration(step.duration) ?? STEP_LABELS.delay
  }
  if (step.type === "contact_update" && step.fields.length > 0) {
    const names = step.fields.map((field) =>
      contactFieldLabel(field.property).toLowerCase()
    )
    return `${STEP_LABELS.contact_update}: ${names.join(", ")}`
  }
  return STEP_LABELS[step.type]
}

/** The line under the name of a collapsed step, when it has one. */
export function stepSummary(
  step: AutomationStep,
  context: StepContext
): string | null {
  switch (step.type) {
    case "condition":
      return step.rules.length > 0
        ? step.rules.map(ruleText).join(` ${step.match} `)
        : null
    case "wait_for_event":
      return step.eventName || null
    case "send_email":
      return (
        context.templates.find((item) => item.id === step.templateId)?.name ??
        "Select template"
      )
    case "add_to_segment":
      return (
        context.segments.find((item) => item.id === step.segmentId)?.name ??
        null
      )
    default:
      return null
  }
}

/* ------------------------------------------------------------------ rules */

type RuleScope = {
  event: Record<string, unknown>
  contact: Record<string, unknown>
}

/** The contact as rules and references see it, under the API's names. */
function contactScope(contact: Contact): Record<string, unknown> {
  return {
    id: contact.id,
    email: contact.email,
    first_name: contact.firstName,
    last_name: contact.lastName,
    unsubscribed: contact.unsubscribed,
    properties: contact.properties,
  }
}

function resolveField(scope: RuleScope, field: string): unknown {
  return field
    .trim()
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>)[part]
          : undefined,
      scope
    )
}

export function evaluateRule(rule: AutomationRule, scope: RuleScope): boolean {
  const actual = resolveField(scope, rule.field)
  const missing = actual === undefined || actual === null
  if (rule.operator === "exists") return !missing
  if (rule.operator === "is_empty") return missing || actual === ""
  if (missing) return rule.operator === "neq"

  const text = String(actual)
  const expected = rule.value.trim()
  switch (rule.operator) {
    case "eq":
      return text === expected
    case "neq":
      return text !== expected
    case "contains":
      return text.includes(expected)
    case "starts_with":
      return text.startsWith(expected)
    case "ends_with":
      return text.endsWith(expected)
  }
  const left = Number(actual)
  const right = Number(expected)
  if (Number.isNaN(left) || Number.isNaN(right)) return false
  switch (rule.operator) {
    case "gt":
      return left > right
    case "gte":
      return left >= right
    case "lt":
      return left < right
    case "lte":
      return left <= right
  }
}

function evaluateRules(
  step: Extract<AutomationStep, { type: "condition" }>,
  scope: RuleScope
): boolean {
  return step.match === "and"
    ? step.rules.every((rule) => evaluateRule(rule, scope))
    : step.rules.some((rule) => evaluateRule(rule, scope))
}

/* ------------------------------------------------------------------- runs */

/** What a test event sends when the schema is all there is to go on. */
export function samplePayload(
  event: Pick<AutomationEvent, "schema"> | undefined
): Record<string, unknown> {
  const samples = { string: "example", number: 1, boolean: true }
  return Object.fromEntries(
    (event?.schema ?? []).map((field) => [
      field.key,
      field.type === "date" ? "2026-01-01T00:00:00.000Z" : samples[field.type],
    ])
  )
}

/** The payload fields that are missing or of the wrong type: what the API
    answers 422 with. */
export function payloadErrors(
  event: Pick<AutomationEvent, "schema"> | undefined,
  payload: Record<string, unknown>
): string[] {
  return (event?.schema ?? []).flatMap((field) => {
    const value = payload[field.key]
    if (value === undefined) return [`${field.key} is missing`]
    const ok =
      field.type === "date"
        ? typeof value === "string" && !Number.isNaN(Date.parse(value))
        : typeof value === field.type
    return ok ? [] : [`${field.key} must be a ${field.type}`]
  })
}

/** What happened at one step of a run. A step still running has no end. */
export function runStep(
  key: string,
  type: AutomationRunStep["type"],
  status: AutomationRunStep["status"],
  at: number,
  extra: Partial<Pick<AutomationRunStep, "output" | "error">> = {}
): AutomationRunStep {
  return {
    key,
    type,
    status,
    startedAt: at,
    completedAt: status === "running" ? null : at,
    output: null,
    error: null,
    ...extra,
  }
}

/** Walks the workflow for one contact, as far as it goes without waiting:
    a delay or a wait for an event leaves the run running. */
export function startRun(input: {
  id: string
  automation: Pick<Automation, "id" | "trigger" | "steps">
  contact: Contact
  payload: Record<string, unknown>
  context: StepContext
  now: number
}): AutomationRun {
  const { automation, contact, payload, context, now } = input
  const scope: RuleScope = { event: payload, contact: contactScope(contact) }
  const done = [
    runStep(TRIGGER_KEY, "trigger", "completed", now, {
      output: { event_name: automation.trigger },
    }),
  ]
  /* Assigned inside `walk`, which narrowing cannot see into. */
  let status = "completed" as AutomationRunStatus
  let unsubscribed = contact.unsubscribed

  const walk = (steps: readonly AutomationStep[]): boolean => {
    for (const step of steps) {
      const record = (
        status: AutomationRunStep["status"],
        extra?: Partial<Pick<AutomationRunStep, "output" | "error">>
      ) => done.push(runStep(step.key, step.type, status, now, extra))

      const problem = stepProblem(step, context)
      if (problem) {
        record("failed", { error: problem })
        status = "failed"
        return false
      }
      switch (step.type) {
        case "delay":
        case "wait_for_event":
          record("running")
          status = "running"
          return false
        case "condition": {
          const met = evaluateRules(step, scope)
          record("completed", { output: { condition_met: met } })
          if (!walk(met ? step.met : step.notMet)) return false
          break
        }
        case "send_email":
          /* An unsubscribed contact is sent nothing; the rest still runs. */
          if (unsubscribed) {
            record("skipped", { output: { reason: "unsubscribed" } })
          } else {
            record("completed", { output: { to: contact.email } })
          }
          break
        case "contact_update": {
          const flag = step.fields.find(
            (field) => field.property === "unsubscribed"
          )
          if (flag) {
            unsubscribed = flag.action === "change" && flag.value === "true"
          }
          record("completed", {
            output: Object.fromEntries(
              step.fields.map((field) => [
                field.property,
                field.action === "clear" ? null : field.value,
              ])
            ),
          })
          break
        }
        case "contact_delete":
        case "add_to_segment":
          record("completed")
          break
      }
    }
    return true
  }
  walk(automation.steps)

  return {
    id: input.id,
    automationId: automation.id,
    status,
    contactEmail: contact.email,
    payload,
    startedAt: now,
    completedAt: status === "running" ? null : now,
    steps: done,
  }
}

/* The history is saved with everything else on every change, so it is kept
   to what the observability view can usefully show. */
const MAX_RUNS_PER_AUTOMATION = 200

/** The newest runs of each automation, given newest first. */
export function keptRuns(runs: readonly AutomationRun[]): AutomationRun[] {
  const counts = new Map<string, number>()
  return runs.filter((run) => {
    const count = (counts.get(run.automationId) ?? 0) + 1
    counts.set(run.automationId, count)
    return count <= MAX_RUNS_PER_AUTOMATION
  })
}

/** Stops a run where it is. Only a run that is waiting can be stopped. */
export function cancelledRun(run: AutomationRun, now: number): AutomationRun {
  if (run.status !== "running") return run
  return {
    ...run,
    status: "cancelled",
    completedAt: now,
    steps: run.steps.map((step) =>
      step.status === "running"
        ? { ...step, status: "cancelled", completedAt: now }
        : step
    ),
  }
}

/** Newest first. */
export function automationRuns(
  runs: readonly AutomationRun[],
  automationId: string
): AutomationRun[] {
  return runs
    .filter((run) => run.automationId === automationId)
    .sort((a, b) => b.startedAt - a.startedAt)
}

/** A length of time in its nearest compact unit: "45s", "3m", "2h", "1d". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

/** How long a run took, or has taken so far. */
export function formatRunDuration(
  run: Pick<AutomationRun, "startedAt" | "completedAt">,
  now: number
): string {
  return formatElapsed((run.completedAt ?? now) - run.startedAt)
}

/** How the runs split by outcome, as whole percentages. */
export function runStatusRates(
  runs: readonly Pick<AutomationRun, "status">[]
): Record<AutomationRunStatus, number> {
  const share = (status: AutomationRunStatus) =>
    rate(runs.filter((run) => run.status === status).length, runs.length)
  return {
    running: share("running"),
    completed: share("completed"),
    failed: share("failed"),
    cancelled: share("cancelled"),
  }
}

export type StepMetrics = { executions: number; averageMs: number | null }

/** How often each step ran across the runs, and how long it took on
    average, from one pass over them. */
export function stepMetrics(
  runs: readonly Pick<AutomationRun, "steps">[]
): Map<string, StepMetrics> {
  const totals = new Map<
    string,
    { executions: number; finished: number; ms: number }
  >()
  for (const run of runs) {
    for (const step of run.steps) {
      const entry = totals.get(step.key) ?? {
        executions: 0,
        finished: 0,
        ms: 0,
      }
      entry.executions += 1
      if (step.completedAt !== null) {
        entry.finished += 1
        entry.ms += step.completedAt - step.startedAt
      }
      totals.set(step.key, entry)
    }
  }
  return new Map(
    [...totals].map(([key, entry]) => [
      key,
      {
        executions: entry.executions,
        averageMs: entry.finished === 0 ? null : entry.ms / entry.finished,
      },
    ])
  )
}

/* -------------------------------------------------------------- migration */

/** Automations saved before they had steps were a name and a trigger. */
export function normalizeAutomation(
  item: Omit<Automation, "steps"> & Partial<Pick<Automation, "steps">>
): Automation {
  return { ...item, steps: item.steps ?? [] }
}
