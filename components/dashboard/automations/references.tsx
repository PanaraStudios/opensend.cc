"use client"
import * as React from "react"
import { BracesIcon } from "lucide-react"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import {
  InputGroup,
  InputGroupInput,
  InputGroupTextarea,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group"
import { SearchableSelect } from "@/components/dashboard/primitives"
import {
  references,
  resolveText,
  variableOptions,
  type VariableOption,
} from "@/lib/automation-references"
import {
  SYSTEM_EVENT_CATALOG,
  CONTACT_SCHEMA,
  type CatalogEvent,
} from "@/lib/event-catalog"
import type { Automation } from "@/lib/dashboard/types"
import type { VariableSource } from "@/lib/meta/variables"
const VariableContext = React.createContext<VariableOption[]>([])
export function useEventCatalog(): CatalogEvent[] {
  const json = useTeamQuery(api.automationEvents.catalog, {})
  return React.useMemo(
    () => (json ? JSON.parse(json) : [...SYSTEM_EVENT_CATALOG]),
    [json]
  )
}
export function ReferenceProvider({
  automation,
  stepKey,
  children,
}: {
  automation: Automation
  stepKey: string
  children: React.ReactNode
}) {
  const catalog = useEventCatalog()
  const contact =
    catalog.find((event) => event.schema.fields?.contact)?.schema.fields
      ?.contact ?? CONTACT_SCHEMA
  return (
    <VariableContext.Provider
      value={variableOptions(
        automation.trigger,
        automation.steps,
        stepKey,
        catalog,
        contact
      )}
    >
      {children}
    </VariableContext.Provider>
  )
}
export function ReferenceInput({
  value,
  onValueChange,
  multiline,
  ...props
}: Omit<React.ComponentProps<"input">, "onChange" | "value"> & {
  value: string
  onValueChange: (value: string) => void
  multiline?: boolean
}) {
  const options = React.useContext(VariableContext)
  const [search, setSearch] = React.useState("")
  const selection = React.useRef({ start: value.length, end: value.length })
  const element = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null
  )
  const onSelect = (
    event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    selection.current = {
      start: event.currentTarget.selectionStart ?? value.length,
      end: event.currentTarget.selectionEnd ?? value.length,
    }
  }
  const tokens = references(value)
  const sample = Object.fromEntries(
    options.map((option) => [option.path, option.field.example])
  )
  const scope = { trigger: {}, steps: {}, contact: {} }
  for (const [path, example] of Object.entries(sample)) {
    let target: Record<string, unknown> = scope
    const parts = path.split(".")
    parts.forEach((part, index) => {
      if (index === parts.length - 1) target[part] = example
      else {
        if (!target[part] || typeof target[part] !== "object") target[part] = {}
        target = target[part] as Record<string, unknown>
      }
    })
  }
  const inputProps = {
    ...props,
    value,
    onSelect,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => onValueChange(event.target.value),
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <InputGroup>
        {multiline ? (
          <InputGroupTextarea
            {...(inputProps as React.ComponentProps<typeof InputGroupTextarea>)}
            ref={(node) => {
              element.current = node
            }}
          />
        ) : (
          <InputGroupInput
            {...inputProps}
            ref={(node) => {
              element.current = node
            }}
          />
        )}
        <InputGroupAddon align={multiline ? "block-end" : "inline-end"}>
          <SearchableSelect
            value=""
            items={options
              .filter((option) =>
                `${option.label} ${option.field.type}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
              .map((option) => ({
                value: option.path,
                label: option.label,
                group: option.group,
                description: `${option.field.type} · ${JSON.stringify(option.field.example)} — ${option.field.description}`,
              }))}
            search={{ onChange: setSearch, placeholder: "Search variables…" }}
            contentClassName="w-96"
            trigger={() => (
              <InputGroupButton aria-label="Insert variable" size="icon-xs">
                <BracesIcon />
              </InputGroupButton>
            )}
            onChange={(path) => {
              const { start, end } = selection.current
              const token = `{{${path}}}`
              onValueChange(value.slice(0, start) + token + value.slice(end))
              requestAnimationFrame(() => {
                element.current?.focus()
                element.current?.setSelectionRange(
                  start + token.length,
                  start + token.length
                )
              })
            }}
          />
        </InputGroupAddon>
        {tokens.length ? (
          <InputGroupAddon align="block-end" className="flex-wrap">
            {tokens.map((path, index) => (
              <Badge key={`${path}-${index}`} variant="secondary">
                {options.find((option) => option.path === path)?.label ?? path}
              </Badge>
            ))}
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {tokens.length ? (
        <span className="text-caption text-muted-foreground">
          Preview: {resolveText(value, scope)}
        </span>
      ) : null}
    </div>
  )
}
export function ReferenceVariableField({
  name,
  value,
  onChange,
}: {
  name: string
  value: VariableSource
  onChange: (value: VariableSource) => void
}) {
  if (typeof value !== "string" && !("value" in value)) return null
  return (
    <ReferenceInput
      aria-label={`Value for {{${name}}}`}
      value={typeof value === "string" ? value : value.value}
      onValueChange={(next) =>
        onChange(typeof value === "string" ? next : { ...value, value: next })
      }
    />
  )
}
