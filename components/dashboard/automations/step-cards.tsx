"use client"
import { PlaceCallFields } from "@/components/dashboard/calling/place-call-fields"
import { readablePath, referenceErrors } from "@/lib/automation-references"
import { automationCatalogNames } from "@/lib/dashboard/event-catalog-options"
import { useResourceOptions } from "@/components/dashboard/resource-picker"
import { catalogContactSchema, eventLabel } from "@/lib/event-catalog"
import { FieldError } from "@/components/ui/field"
import {
  ReferenceInput,
  ReferenceFieldSelect,
  useReferenceOptions,
  ReferenceProvider,
  ReferenceVariableField,
  useEventCatalog,
} from "./references"
import { flattenSchema, catalogEvent } from "@/lib/event-catalog"
import { channelIcon } from "@/components/dashboard/channels/shared"
import { InstanceChannelConfiguration } from "@/components/ses/email-configuration"

import { channelForSendStep } from "@/lib/channels"

import * as React from "react"
import type { Id } from "@/convex/_generated/dataModel"
import Link from "next/link"
import { PencilIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"

import { WhatsAppCampaignFields } from "@/components/dashboard/whatsapp-campaign-fields"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { EventFormDialog } from "@/components/dashboard/automations/events"
import { EventIcon } from "@/components/dashboard/automations/shared"
import { WorkflowCard } from "@/components/dashboard/flows/workflow"
import type { FlowPresentation } from "@/components/dashboard/flows/catalog"
import {
  CopyButton,
  MoreMenu,
  OptionSelect,
  SuggestInput,
  SearchableSelect,
  useDraft,
} from "@/components/dashboard/primitives"
import { TemplateThumbnail } from "@/components/dashboard/templates/shared"
import { useAutomationEvent } from "@/lib/automation-events/use-automation-events"
import {
  contactFieldLabel,
  operatorTakesValue,
  RULE_OPERATOR_LABELS,
  ruleError,
  stepTasks,
  UPDATABLE_CONTACT_FIELDS,
} from "@/lib/dashboard/automation"
import { formatVariable } from "@/lib/dashboard/email-variables"
import { useStepContext } from "@/lib/automations/use-automations"
import { useTemplate, asTemplate } from "@/lib/templates/use-templates"
import { asSegment } from "@/lib/audience/use-audience"
import { useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { useQuery } from "convex/react"
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
  const catalog = useEventCatalog([trigger])
  return flattenSchema(
    catalogEvent(catalog, trigger)?.schema ?? {
      type: "object",
      description: "",
      example: {},
    }
  ).map((field) => `event.${field.path}`)
}

function usePropertyOptions(
  prefix: string,
  builtin: readonly string[],
  excluded: readonly string[] = []
) {
  const { activeTeamId } = useWorkspace()
  const [search, setSearch] = React.useState("")
  const properties = useQuery(
    api.contactProperties.options,
    activeTeamId
      ? {
          organizationId: activeTeamId,
          search: search.startsWith(prefix)
            ? search.slice(prefix.length)
            : search,
        }
      : "skip"
  )
  const pageRows = [
    ...builtin,
    ...(properties ?? []).map((item) => `${prefix}${item.key}`),
  ].filter(
    (key) =>
      !excluded.includes(key) &&
      key.toLowerCase().includes(search.toLowerCase())
  )
  return { pageRows, setSearch }
}

/** The event box: a defined event, or the name of a new one. */
function EventNameInput(props: {
  value: string
  onChange: (value: string) => void
  "aria-label": string
}) {
  const { rows, setSearch } = useResourceOptions(
    api.automationEventCatalog.options,
    { selectedNames: [props.value] }
  )
  const catalog = rows ?? []
  const options = catalog.map((event) => ({
    value: event.trigger,
    label: event.label,
    group: event.group,
    description: event.description,
    icon: event.name.startsWith("whatsapp.")
      ? (channelIcon("whatsapp") as typeof EventIcon)
      : event.name.startsWith("instagram.")
        ? (channelIcon("instagram") as typeof EventIcon)
        : event.name.startsWith("messenger.")
          ? (channelIcon("messenger") as typeof EventIcon)
          : EventIcon,
  }))
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <SearchableSelect
        value={props.value}
        items={options}
        selectedItem={options.find((item) => item.value === props.value)}
        search={{ onChange: setSearch, placeholder: "Search events…" }}
        contentClassName="w-96"
        onChange={props.onChange}
        trigger={(current) => (
          <Button
            variant="outline"
            aria-label={`${props["aria-label"]} picker`}
          >
            <span className="truncate">
              {current?.label ?? (props.value || "Select event")}
            </span>
          </Button>
        )}
      />
      {!catalogEvent(catalog, props.value) ? (
        <SuggestInput
          {...props}
          options={options.filter((item) => item.group === "Custom events")}
          placeholder="Custom event name"
          createLabel="Create event"
        />
      ) : null}
      {catalogEvent(catalog, props.value) ? (
        <p className="text-caption text-muted-foreground">
          {catalogEvent(catalog, props.value)?.description}
        </p>
      ) : null}
    </div>
  )
}

/* ---------------------------------------------------------------- trigger */

export function TriggerCard({
  automation,
  selected,
  locked,
  onSelect,
  onChange,
  onFiltersChange,
}: {
  automation: Automation
  selected: boolean
  locked: boolean
  onSelect: () => void
  onChange: (trigger: string) => void
  onFiltersChange: (rules: AutomationRule[]) => void
}) {
  const catalog = useEventCatalog(
    automationCatalogNames(automation.trigger, automation.steps)
  )
  const errors = referenceErrors(
    automation.trigger,
    [],
    catalog,
    catalogContactSchema(catalog),
    automation.triggerFilters
  ).filter((error) => error.startsWith("Trigger:"))
  const [editingEvent, setEditingEvent] = React.useState(false)
  const event = useAutomationEvent(automation.trigger)

  return (
    <WorkflowCard
      data-testid="workflow-node-start"
      icon={EventIcon}
      title={selected ? "Event" : eventLabel(automation.trigger)}
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
      {selected ? (
        <ReferenceProvider automation={automation} stepKey="start">
          <ConditionBody
            step={{
              key: "start",
              type: "condition",
              match: "and",
              rules: automation.triggerFilters ?? [],
              met: [],
              notMet: [],
            }}
            onChange={(step) => {
              if (step.type === "condition") onFiltersChange(step.rules)
            }}
          />
        </ReferenceProvider>
      ) : null}
      {errors.length ? <FieldError>{errors.join("; ")}</FieldError> : null}
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
  editor,
  presentation,
}: {
  automation: Automation
  step: AutomationStep
  selected: boolean
  locked: boolean
  onSelect: () => void
  onChange: (step: AutomationStep) => void
  onRemove: () => void
  editor?: React.ReactNode
  presentation: FlowPresentation
}) {
  const catalog = useEventCatalog(
    automationCatalogNames(automation.trigger, automation.steps)
  )
  const errors = referenceErrors(
    automation.trigger,
    automation.steps,
    catalog,
    catalogContactSchema(catalog),
    automation.triggerFilters
  ).filter((error) => error.startsWith(`${step.key}:`))
  const context = useStepContext(automation.steps)
  const tasks = context ? stepTasks(step, context) : []

  return (
    <WorkflowCard
      data-testid={`workflow-node-${step.key}`}
      icon={presentation.icon}
      title={presentation.title}
      summary={selected || !context ? null : presentation.summary}
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
      {errors.length ? <FieldError>{errors.join("; ")}</FieldError> : null}
      {selected ? (
        <ReferenceProvider automation={automation} stepKey={step.key}>
          {editor ?? (
            <StepBody automation={automation} step={step} onChange={onChange} />
          )}
        </ReferenceProvider>
      ) : null}
    </WorkflowCard>
  )
}

export function StepBody({
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
        <>
          <DurationInput
            aria-label="Delay"
            value={step.duration}
            onChange={(duration) =>
              onChange({ ...step, duration, until: undefined })
            }
          />
          <ReferenceInput
            aria-label="Delay until"
            placeholder="Or a date / variable"
            value={step.until ?? ""}
            onValueChange={(until) => onChange({ ...step, until })}
          />
        </>
      )
    case "condition":
      return <ConditionBody step={step} onChange={onChange} />
    case "wait_for_event":
      return <WaitBody step={step} onChange={onChange} />
    case "place_call":
      return (
        <PlaceCallFields
          config={step}
          onChange={(config) => onChange({ ...step, ...config })}
        />
      )
    case "send_messenger":
    case "send_instagram":
    case "send_whatsapp":
      return (
        <InstanceChannelConfiguration channel="meta">
          <WhatsAppCampaignFields
            config={step}
            channel={channelForSendStep(step.type)}
            allowText
            renderTextField={(props) => (
              <ReferenceInput
                {...props}
                multiline
                onValueChange={props.onChange}
              />
            )}
            renderVariableField={(props) => (
              <ReferenceVariableField {...props} />
            )}
            onChange={(config) =>
              onChange({
                ...step,
                ...config,
                mode: config.mode ?? "template",
                templateId: config.templateId ?? "",
                text: config.text ?? "",
              })
            }
          />
        </InstanceChannelConfiguration>
      )
    case "send_email":
      return (
        <InstanceChannelConfiguration channel="email">
          <SendEmailBody
            trigger={automation.trigger}
            step={step}
            onChange={onChange}
          />
        </InstanceChannelConfiguration>
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
  return (
    <ReferenceInput
      value={value}
      onValueChange={onChange}
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
  const { activeTeamId } = useWorkspace()
  const [segmentSearch, setSegmentSearch] = React.useState("")
  const rows = useQuery(
    api.segments.options,
    activeTeamId
      ? {
          organizationId: activeTeamId,
          search: segmentSearch,
          selectedId: step.segmentId
            ? (step.segmentId as Id<"segments">)
            : undefined,
        }
      : "skip"
  )
  const segments = (rows ?? []).map(asSegment)
  const selected = segments.find((item) => item.id === step.segmentId)
  const id = React.useId()
  return (
    <CardSection label="Segment" htmlFor={id}>
      <OptionSelect
        search={{ onChange: setSegmentSearch }}
        id={id}
        className="w-full"
        value={step.segmentId}
        selectedItem={
          selected ? { value: selected.id, label: selected.name } : undefined
        }
        placeholder="Select a segment"
        onChange={(segmentId) => onChange({ ...step, segmentId })}
        items={segments.map((segment) => ({
          value: segment.id,
          label: segment.name,
        }))}
      />
    </CardSection>
  )
}

/* -------------------------------------------------------------- condition */

function ConditionBody({
  step,
  onChange,
}: {
  step: StepOf<"condition">
  onChange: (step: AutomationStep) => void
}) {
  /* The rule in the form: a new one (its index is the list's length), one
     being edited, or none. */
  const variables = useReferenceOptions()
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
              {rule.field.startsWith("contact.") ? "Contact" : "Event"}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
              {variables.find(
                (item) =>
                  item.path === rule.field.replace(/^event\./, "trigger.")
              )?.label ?? readablePath(rule.field)}{" "}
              {RULE_OPERATOR_LABELS[rule.operator]}{" "}
              {rule.value.includes("{{") ? "variable" : rule.value}
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
  rule,
  onCancel,
  onSubmit,
}: {
  rule: AutomationRule | undefined
  onCancel?: () => void
  onSubmit: (rule: AutomationRule) => void
}) {
  const [field, setField] = React.useState(rule?.field ?? "")
  const [operator, setOperator] = React.useState<AutomationRuleOperator>(
    rule?.operator ?? "eq"
  )
  const [value, setValue] = React.useState(rule?.value ?? "")
  const next: AutomationRule = { field, operator, value }

  return (
    <div className="flex flex-col gap-2">
      <ReferenceFieldSelect value={field} onChange={setField} />
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
          <ReferenceInput
            aria-label="Value"
            className="min-w-0 flex-1"
            value={value}
            placeholder="Value"
            onValueChange={setValue}
          />
        ) : null}
      </div>
      {/* Said once a property is in, so the Add button is never dead without
          a reason. */}
      {field.trim() && ruleError(next) ? (
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
  const { activeTeamId } = useWorkspace()
  const [templateSearch, setTemplateSearch] = React.useState("")
  const rows = useQuery(
    api.templates.options,
    activeTeamId
      ? {
          organizationId: activeTeamId,
          search: templateSearch,
          selectedId: step.templateId
            ? (step.templateId as Id<"templates">)
            : undefined,
        }
      : "skip"
  )
  const hasTemplates = useQuery(
    api.templates.hasAny,
    activeTeamId ? { organizationId: activeTeamId } : "skip"
  )
  const templates = (rows ?? []).map((row) => asTemplate(row))
  useEventReferences(trigger)
  const withBody = useTemplate(step.templateId || undefined)
  const picked = withBody ?? undefined
  const from = useDraft(step.from, (value) =>
    onChange({ ...step, from: value })
  )
  const replyTo = useDraft(step.replyTo, (value) =>
    onChange({ ...step, replyTo: value })
  )

  if (hasTemplates === false) {
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
        search={{ onChange: setTemplateSearch }}
        className="w-full"
        aria-label="Template"
        value={step.templateId}
        selectedItem={
          picked
            ? {
                value: picked.id,
                label:
                  picked.status === "published"
                    ? picked.name
                    : `${picked.name} (draft)`,
              }
            : undefined
        }
        placeholder="Select template"
        onChange={(templateId) =>
          onChange({ ...step, templateId, variables: {} })
        }
        items={templates.map((item) => ({
          value: item.id,
          label:
            item.status === "published" ? item.name : `${item.name} (draft)`,
        }))}
      />
      {picked ? (
        <>
          <div className="relative">
            <TemplateThumbnail item={withBody ?? picked} />
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 font-mono"
            >
              {picked.alias}
            </Badge>
          </div>
          <CardSection label="Subject">
            <ReferenceInput
              aria-label="Email subject"
              placeholder={picked.subject}
              value={step.subject ?? ""}
              onValueChange={(subject) =>
                onChange({ ...step, subject: subject || undefined })
              }
            />
          </CardSection>
          <CardSection label="Sender">
            <ReferenceInput
              {...from}
              onValueChange={(value) => onChange({ ...step, from: value })}
              aria-label="From"
              placeholder={picked.from || "From"}
            />
            <ReferenceInput
              {...replyTo}
              onValueChange={(value) => onChange({ ...step, replyTo: value })}
              aria-label="Reply to"
              placeholder="Reply to (optional)"
            />
          </CardSection>
          {picked.variables.length > 0 ? (
            <CardSection label="Set variables">
              {picked.variables.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[13px]">
                    {formatVariable(name)}
                  </code>
                  <div className="w-44 shrink-0">
                    <ReferenceInput
                      aria-label={`Value for ${name}`}
                      value={step.variables[name] ?? ""}
                      onValueChange={(value) =>
                        onChange({
                          ...step,
                          variables: { ...step.variables, [name]: value },
                        })
                      }
                      placeholder="Text or variable"
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
  const custom = usePropertyOptions(
    "",
    UPDATABLE_CONTACT_FIELDS,
    step.fields.map((field) => field.property)
  )
  useEventReferences(trigger)
  const [property, setProperty] = React.useState("")
  const [action, setAction] =
    React.useState<AutomationContactField["action"]>("change")
  const [value, setValue] = React.useState("")

  const properties = custom.pageRows

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
              selectedItem={
                property
                  ? { value: property, label: contactFieldLabel(property) }
                  : undefined
              }
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
            <ReferenceInput
              aria-label="Value"
              value={value}
              onValueChange={setValue}
              placeholder="Text or variable"
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
