"use client"

import * as React from "react"
import Link from "next/link"
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EventFormDialog } from "@/components/dashboard/automations/events"
import {
  EventIcon,
  STEP_ICONS,
} from "@/components/dashboard/automations/shared"
import { WorkflowCard } from "@/components/dashboard/automations/workflow"
import {
  CopyButton,
  MoreMenu,
  OptionSelect,
  SuggestInput,
  useDraft,
} from "@/components/dashboard/primitives"
import { TemplateThumbnail } from "@/components/dashboard/templates/shared"
import {
  CONTACT_FIELDS,
  contactFieldLabel,
  operatorTakesValue,
  RULE_OPERATOR_LABELS,
  ruleError,
  ruleText,
  splitField,
  stepSummary,
  stepTasks,
  stepTitle,
  UPDATABLE_CONTACT_FIELDS,
} from "@/lib/dashboard/automation"
import { formatVariable } from "@/lib/dashboard/email-variables"
import { useDashboard } from "@/lib/dashboard/store"
import {
  AUTOMATION_RULE_OPERATORS,
  type Automation,
  type AutomationContactField,
  type AutomationRule,
  type AutomationRuleOperator,
  type AutomationStep,
} from "@/lib/dashboard/types"

/* The cards of the editor's graph. A card shows its settings when it is the
   selected one, and edits apply as they are made: the graph is the form. */

const OPERATOR_ITEMS = AUTOMATION_RULE_OPERATORS.map((value) => ({
  value,
  label: RULE_OPERATOR_LABELS[value],
}))

const FIELD_ACTION_ITEMS = [
  { value: "clear", label: "Clear" },
  { value: "change", label: "Change to" },
]

/** A titled block inside a card. */
function CardSection({
  label,
  htmlFor,
  children,
}: {
  label?: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
      {label ? (
        <Label htmlFor={htmlFor} className="text-caption">
          {label}
        </Label>
      ) : null}
      {children}
    </div>
  )
}

/** The payload fields of the trigger's event, as references. */
function useEventReferences(trigger: string): string[] {
  const { state } = useDashboard()
  const event = state.automationEvents.find((item) => item.name === trigger)
  return (event?.schema ?? []).map((field) => `event.${field.key}`)
}

const CONTACT_REFERENCES = CONTACT_FIELDS.map((key) => `contact.${key}`)

/** The event box: a defined event, or the name of a new one. */
function EventNameInput(props: {
  value: string
  onChange: (value: string) => void
  "aria-label": string
}) {
  const { state } = useDashboard()
  return (
    <SuggestInput
      {...props}
      options={state.automationEvents.map((item) => item.name)}
      placeholder="Type or select an event"
      createLabel="Create event"
      className="font-mono"
    />
  )
}

/* ---------------------------------------------------------------- trigger */

export function TriggerCard({
  automation,
  selected,
  locked,
  onSelect,
  onChange,
}: {
  automation: Automation
  selected: boolean
  locked: boolean
  onSelect: () => void
  onChange: (trigger: string) => void
}) {
  const { state } = useDashboard()
  const [editingEvent, setEditingEvent] = React.useState(false)
  const event = state.automationEvents.find(
    (item) => item.name === automation.trigger
  )

  return (
    <WorkflowCard
      data-testid="workflow-node-start"
      icon={EventIcon}
      title={selected ? "Custom event" : automation.trigger || "Custom event"}
      tone={automation.trigger ? undefined : "warning"}
      onSelect={locked ? undefined : onSelect}
    >
      {selected ? (
        <div className="flex items-center gap-1">
          <EventNameInput
            aria-label="Event"
            value={automation.trigger}
            onChange={onChange}
          />
          {event ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit event properties"
                onClick={() => setEditingEvent(true)}
              >
                <PencilIcon />
              </Button>
              <CopyButton value={event.name} />
            </>
          ) : null}
        </div>
      ) : null}
      <EventFormDialog
        event={event ?? null}
        open={editingEvent}
        onOpenChange={setEditingEvent}
      />
    </WorkflowCard>
  )
}

/* ------------------------------------------------------------------ steps */

export function StepCard({
  automation,
  step,
  selected,
  locked,
  onSelect,
  onChange,
  onRemove,
}: {
  automation: Automation
  step: AutomationStep
  selected: boolean
  locked: boolean
  onSelect: () => void
  onChange: (step: AutomationStep) => void
  onRemove: () => void
}) {
  const { state } = useDashboard()
  const tasks = stepTasks(step, state)

  return (
    <WorkflowCard
      data-testid={`workflow-node-${step.key}`}
      icon={STEP_ICONS[step.type]}
      title={stepTitle(step)}
      summary={selected ? null : stepSummary(step, state)}
      tone={tasks.length > 0 ? "warning" : undefined}
      onSelect={locked ? undefined : onSelect}
      actions={
        locked ? null : (
          <MoreMenu>
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
                <Trash2Icon />
                Remove
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </MoreMenu>
        )
      }
    >
      {selected ? (
        <StepBody automation={automation} step={step} onChange={onChange} />
      ) : null}
    </WorkflowCard>
  )
}

function StepBody({
  automation,
  step,
  onChange,
}: {
  automation: Automation
  step: AutomationStep
  onChange: (step: AutomationStep) => void
}) {
  switch (step.type) {
    case "delay":
      return (
        <DurationInput
          aria-label="Delay"
          value={step.duration}
          onChange={(duration) => onChange({ ...step, duration })}
        />
      )
    case "condition":
      return (
        <ConditionBody
          trigger={automation.trigger}
          step={step}
          onChange={onChange}
        />
      )
    case "wait_for_event":
      return <WaitBody step={step} onChange={onChange} />
    case "send_email":
      return (
        <SendEmailBody
          trigger={automation.trigger}
          step={step}
          onChange={onChange}
        />
      )
    case "contact_update":
      return (
        <UpdateContactBody
          trigger={automation.trigger}
          step={step}
          onChange={onChange}
        />
      )
    case "add_to_segment":
      return <SegmentBody step={step} onChange={onChange} />
    case "contact_delete":
      return (
        <p className="text-sm text-muted-foreground">
          Finds the contact by email address and deletes it when this step runs.
          This cannot be undone.
        </p>
      )
  }
}

function DurationInput({
  value,
  onChange,
  id,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  "aria-label"?: string
}) {
  const draft = useDraft(value, onChange)
  return (
    <Input
      {...draft}
      id={id}
      aria-label={ariaLabel}
      placeholder="e.g. 10 minutes, 2h, 1h 30m"
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
      }}
    />
  )
}

type StepOf<T extends AutomationStep["type"]> = Extract<
  AutomationStep,
  { type: T }
>

function WaitBody({
  step,
  onChange,
}: {
  step: StepOf<"wait_for_event">
  onChange: (step: AutomationStep) => void
}) {
  const id = React.useId()
  return (
    <>
      <CardSection label="Event">
        <EventNameInput
          aria-label="Event to wait for"
          value={step.eventName}
          onChange={(eventName) => onChange({ ...step, eventName })}
        />
      </CardSection>
      <CardSection label="Timeout in" htmlFor={id}>
        <DurationInput
          id={id}
          value={step.timeout}
          onChange={(timeout) => onChange({ ...step, timeout })}
        />
      </CardSection>
    </>
  )
}

function SegmentBody({
  step,
  onChange,
}: {
  step: StepOf<"add_to_segment">
  onChange: (step: AutomationStep) => void
}) {
  const { state } = useDashboard()
  const id = React.useId()
  return (
    <CardSection label="Segment" htmlFor={id}>
      <OptionSelect
        id={id}
        className="w-full"
        value={step.segmentId}
        placeholder="Select a segment"
        onChange={(segmentId) => onChange({ ...step, segmentId })}
        items={state.segments.map((segment) => ({
          value: segment.id,
          label: segment.name,
        }))}
      />
    </CardSection>
  )
}

/* -------------------------------------------------------------- condition */

function ConditionBody({
  trigger,
  step,
  onChange,
}: {
  trigger: string
  step: StepOf<"condition">
  onChange: (step: AutomationStep) => void
}) {
  /* The rule in the form: a new one (its index is the list's length), one
     being edited, or none. */
  const [editing, setEditing] = React.useState<number | null>(
    step.rules.length === 0 ? 0 : null
  )

  return (
    <CardSection label={step.rules.length > 0 ? "Conditions" : "Add condition"}>
      {step.rules.map((rule, index) =>
        editing === index ? null : (
          <div key={index} className="flex items-center gap-1.5">
            {index > 0 ? (
              <span className="text-caption text-muted-foreground uppercase">
                {step.match}
              </span>
            ) : null}
            <Badge variant="outline" className="shrink-0">
              {splitField(rule.field).scope === "contact" ? "Contact" : trigger}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
              {ruleText(rule)}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit condition ${index + 1}`}
              onClick={() => setEditing(index)}
            >
              <PencilIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove condition ${index + 1}`}
              onClick={() => {
                onChange({ ...step, rules: step.rules.toSpliced(index, 1) })
                /* The form holds its rule by position, which moves up when
                   a rule before it goes. */
                if (editing !== null && index < editing) setEditing(editing - 1)
              }}
            >
              <XIcon />
            </Button>
          </div>
        )
      )}
      {editing === null ? (
        <div className="flex gap-1.5">
          {/* The first join picks how all the rules combine. */}
          {(step.rules.length > 1
            ? [step.match]
            : (["and", "or"] as const)
          ).map((match) => (
            <Button
              key={match}
              variant="outline"
              size="sm"
              className="capitalize"
              onClick={() => {
                onChange({ ...step, match })
                setEditing(step.rules.length)
              }}
            >
              {match}
            </Button>
          ))}
        </div>
      ) : (
        <RuleForm
          key={editing}
          trigger={trigger}
          rule={step.rules[editing]}
          onCancel={
            step.rules.length === 0 ? undefined : () => setEditing(null)
          }
          onSubmit={(rule) => {
            onChange({ ...step, rules: step.rules.toSpliced(editing, 1, rule) })
            setEditing(null)
          }}
        />
      )}
    </CardSection>
  )
}

function RuleForm({
  trigger,
  rule,
  onCancel,
  onSubmit,
}: {
  trigger: string
  rule: AutomationRule | undefined
  onCancel?: () => void
  onSubmit: (rule: AutomationRule) => void
}) {
  const { state } = useDashboard()
  const eventReferences = useEventReferences(trigger)
  const [scope, setScope] = React.useState<"event" | "contact" | null>(
    rule ? splitField(rule.field).scope : null
  )
  const [property, setProperty] = React.useState(
    rule ? splitField(rule.field).property : ""
  )
  const [operator, setOperator] = React.useState<AutomationRuleOperator>(
    rule?.operator ?? "eq"
  )
  const [value, setValue] = React.useState(rule?.value ?? "")

  if (scope === null) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" onClick={() => setScope("event")}>
          <EventIcon data-icon="inline-start" />
          {trigger || "Event"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setScope("contact")}>
          Contact
        </Button>
      </div>
    )
  }

  const next: AutomationRule = {
    field: `${scope}.${property.trim()}`,
    operator,
    value,
  }
  const properties =
    scope === "event"
      ? eventReferences.map((name) => splitField(name).property)
      : [
          ...CONTACT_FIELDS,
          ...state.properties.map((item) => `properties.${item.key}`),
        ]

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Badge variant="outline">
          {scope === "contact" ? "Contact" : trigger || "Event"}
        </Badge>
        {rule ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Choose another source"
            onClick={() => setScope(null)}
          >
            <XIcon />
          </Button>
        )}
      </div>
      <SuggestInput
        aria-label="Property name"
        value={property}
        onChange={setProperty}
        options={properties}
        placeholder="Property name"
        className="font-mono"
      />
      <div className="flex gap-2">
        <OptionSelect
          className="min-w-0 flex-1"
          aria-label="Operator"
          value={operator}
          onChange={(selected) =>
            setOperator(selected as AutomationRuleOperator)
          }
          items={OPERATOR_ITEMS}
        />
        {operatorTakesValue(operator) ? (
          <Input
            aria-label="Value"
            className="min-w-0 flex-1"
            value={value}
            placeholder="Value"
            onChange={(event) => setValue(event.target.value)}
          />
        ) : null}
      </div>
      {/* Said once a property is in, so the Add button is never dead without
          a reason. */}
      {property.trim() && ruleError(next) ? (
        <p className="text-caption text-muted-foreground">{ruleError(next)}</p>
      ) : null}
      <div className="flex justify-end gap-1.5">
        {onCancel ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="sm"
          data-testid="rule-add"
          disabled={ruleError(next) !== null}
          onClick={() => onSubmit(next)}
        >
          {rule ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- send email */

function SendEmailBody({
  trigger,
  step,
  onChange,
}: {
  trigger: string
  step: StepOf<"send_email">
  onChange: (step: AutomationStep) => void
}) {
  const { state } = useDashboard()
  const references = [...useEventReferences(trigger), ...CONTACT_REFERENCES]
  const template = state.templates.find((item) => item.id === step.templateId)
  const from = useDraft(step.from, (value) =>
    onChange({ ...step, from: value })
  )
  const replyTo = useDraft(step.replyTo, (value) =>
    onChange({ ...step, replyTo: value })
  )

  if (state.templates.length === 0) {
    return (
      <CardSection>
        <p className="text-sm font-medium">No templates yet</p>
        <p className="text-sm text-muted-foreground">
          Create a template to use it in this step.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          nativeButton={false}
          render={<Link href="/templates" />}
        >
          Create new
        </Button>
      </CardSection>
    )
  }

  return (
    <>
      <OptionSelect
        className="w-full"
        aria-label="Template"
        value={step.templateId}
        placeholder="Select template"
        onChange={(templateId) =>
          onChange({ ...step, templateId, variables: {} })
        }
        items={state.templates.map((item) => ({
          value: item.id,
          label:
            item.status === "published" ? item.name : `${item.name} (draft)`,
        }))}
      />
      {template ? (
        <>
          <div className="relative">
            <TemplateThumbnail item={template} />
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 font-mono"
            >
              {template.alias}
            </Badge>
          </div>
          <CardSection label="Sender">
            <Input
              {...from}
              aria-label="From"
              placeholder={template.from || "From"}
            />
            <Input
              {...replyTo}
              aria-label="Reply to"
              placeholder="Reply to (optional)"
            />
          </CardSection>
          {template.variables.length > 0 ? (
            <CardSection label="Set variables">
              {template.variables.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {formatVariable(name)}
                  </code>
                  <div className="w-44 shrink-0">
                    <SuggestInput
                      aria-label={`Value for ${name}`}
                      value={step.variables[name] ?? ""}
                      onChange={(value) =>
                        onChange({
                          ...step,
                          variables: { ...step.variables, [name]: value },
                        })
                      }
                      options={references}
                      placeholder="Type or select a prop"
                      createLabel="Add as string"
                    />
                  </div>
                </div>
              ))}
            </CardSection>
          ) : null}
        </>
      ) : null}
    </>
  )
}

/* --------------------------------------------------------- update contact */

function UpdateContactBody({
  trigger,
  step,
  onChange,
}: {
  trigger: string
  step: StepOf<"contact_update">
  onChange: (step: AutomationStep) => void
}) {
  const { state } = useDashboard()
  const references = useEventReferences(trigger)
  const [property, setProperty] = React.useState("")
  const [action, setAction] =
    React.useState<AutomationContactField["action"]>("change")
  const [value, setValue] = React.useState("")

  const taken = new Set(step.fields.map((field) => field.property))
  const properties = [
    ...UPDATABLE_CONTACT_FIELDS,
    ...state.properties.map((item) => item.key),
  ].filter((key) => !taken.has(key))

  return (
    <>
      {step.fields.length > 0 ? (
        <CardSection label="Fields to update">
          {step.fields.map((field, index) => (
            <div key={field.property} className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {contactFieldLabel(field.property)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {field.action === "clear" ? "Cleared" : field.value}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${contactFieldLabel(field.property)}`}
                onClick={() =>
                  onChange({ ...step, fields: step.fields.toSpliced(index, 1) })
                }
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </CardSection>
      ) : null}
      {properties.length > 0 ? (
        <CardSection label="Add field to update">
          <div className="flex gap-2">
            <OptionSelect
              className="min-w-0 flex-1"
              aria-label="Select property"
              placeholder="Select property"
              value={property}
              onChange={setProperty}
              items={properties.map((key) => ({
                value: key,
                label: contactFieldLabel(key),
              }))}
            />
            <OptionSelect
              className="min-w-0 flex-1"
              aria-label="Select action"
              value={action}
              onChange={(selected) =>
                setAction(selected as AutomationContactField["action"])
              }
              items={FIELD_ACTION_ITEMS}
            />
          </div>
          {action === "change" ? (
            <SuggestInput
              aria-label="Value"
              value={value}
              onChange={setValue}
              options={
                property === "unsubscribed" ? ["true", "false"] : references
              }
              placeholder="Type or select a property"
              createLabel="Add as string"
            />
          ) : null}
          <Button
            size="sm"
            className="w-fit self-end"
            data-testid="field-add"
            disabled={!property || (action === "change" && !value.trim())}
            onClick={() => {
              onChange({
                ...step,
                fields: [
                  ...step.fields,
                  { property, action, value: action === "clear" ? "" : value },
                ],
              })
              setProperty("")
              setValue("")
            }}
          >
            <PlusIcon data-icon="inline-start" />
            Add
          </Button>
        </CardSection>
      ) : null}
    </>
  )
}
