"use client"
import * as React from "react"
import { BracesIcon, XIcon } from "lucide-react"
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
  referenceParts,
  resolveText,
  variableOptions,
  type VariableOption,
} from "@/lib/automation-references"
import { fieldTypeLabel } from "@/lib/dashboard/format"
import { SYSTEM_EVENT_CATALOG, type CatalogEvent } from "@/lib/event-catalog"
import type { Automation } from "@/lib/dashboard/types"
import type { VariableSource } from "@/lib/meta/variables"
const VariableContext = React.createContext<VariableOption[]>([])
export const useReferenceOptions = () => React.useContext(VariableContext)
export function ReferenceFieldSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const options = useReferenceOptions()
  const [search, setSearch] = React.useState("")
  const path = value
    .replace(/^event\./, "trigger.")
    .replace(/^\{\{\s*|\s*\}\}$/g, "")
  return (
    <SearchableSelect
      value={path}
      items={options
        .filter((option) =>
          option.label.toLowerCase().includes(search.toLowerCase())
        )
        .map((option) => ({
          value: option.path,
          label: option.label,
          group: option.group,
          description: `${fieldTypeLabel(option.field.type)} · ${option.field.description}`,
        }))}
      search={{ onChange: setSearch, placeholder: "Search fields…" }}
      contentClassName="w-96"
      onChange={onChange}
      trigger={(current) => (
        <InputGroupButton
          aria-label="Condition field"
          variant="outline"
          size="sm"
        >
          {current?.label ?? "Choose a field"}
        </InputGroupButton>
      )}
    />
  )
}
export function useEventCatalog(): CatalogEvent[] {
  const catalog = useTeamQuery(api.automationEvents.catalog, {})
  return catalog ?? [...SYSTEM_EVENT_CATALOG]
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
  return (
    <VariableContext.Provider
      value={variableOptions(
        automation.trigger,
        automation.steps,
        stepKey,
        catalog
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
  const elements = React.useRef(
    new Map<number, HTMLInputElement | HTMLTextAreaElement>()
  )
  const parts = referenceParts(value)
  const onSelect = (
    event: React.SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>,
    offset: number
  ) => {
    selection.current = {
      start: offset + (event.currentTarget.selectionStart ?? 0),
      end: offset + (event.currentTarget.selectionEnd ?? 0),
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
      if (index === parts.length - 1) target[part] = structuredClone(example)
      else {
        if (!target[part] || typeof target[part] !== "object") target[part] = {}
        target = target[part] as Record<string, unknown>
      }
    })
  }
  const remove = (index: number) => {
    const part = parts[index]
    onValueChange(value.slice(0, part.start) + value.slice(part.end))
    // Removing a chip merges its two adjacent literal spans.
    requestAnimationFrame(() => {
      const element = elements.current.get(Math.max(0, index - 1))
      element?.focus()
      element?.setSelectionRange(
        parts[index - 1]?.text.length ?? 0,
        parts[index - 1]?.text.length ?? 0
      )
    })
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <InputGroup
        aria-label={
          tokens.length && props["aria-label"]
            ? `${props["aria-label"]} field`
            : undefined
        }
        className={
          tokens.length ? "h-auto flex-wrap gap-1 px-2 py-1" : undefined
        }
      >
        {parts.map((part, index) => {
          if (part.path)
            return (
              <Badge
                key={index}
                variant="secondary"
                className="max-w-full gap-1 whitespace-normal"
              >
                {options.find((option) => option.path === part.path)?.label ??
                  "Unknown variable"}
                <InputGroupButton
                  aria-label={`Remove ${options.find((option) => option.path === part.path)?.label ?? "variable"}`}
                  size="icon-xs"
                  disabled={props.disabled}
                  onClick={() => remove(index)}
                >
                  <XIcon />
                </InputGroupButton>
              </Badge>
            )
          const inputProps = {
            ...props,
            id: index === 0 ? props.id : undefined,
            "aria-label":
              index === 0
                ? props["aria-label"]
                : `${props["aria-label"] ?? "Text"} continuation ${index / 2}`,
            placeholder: index === 0 ? props.placeholder : undefined,
            value: part.text,
            className: tokens.length
              ? "h-auto min-w-4 flex-none px-0 py-1 last-of-type:flex-1"
              : props.className,
            style: tokens.length
              ? {
                  width: `${Math.max(2, part.text.length + 1)}ch`,
                  maxWidth: "100%",
                }
              : props.style,
            onSelect: (
              event: React.SyntheticEvent<
                HTMLInputElement | HTMLTextAreaElement
              >
            ) => onSelect(event, part.start),
            onChange: (
              event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
            ) =>
              onValueChange(
                value.slice(0, part.start) +
                  event.target.value +
                  value.slice(part.end)
              ),
            onKeyDown: (
              event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
            ) => {
              props.onKeyDown?.(event as React.KeyboardEvent<HTMLInputElement>)
              if (
                event.defaultPrevented ||
                event.currentTarget.selectionStart !==
                  event.currentTarget.selectionEnd
              )
                return
              if (
                event.key === "Backspace" &&
                event.currentTarget.selectionStart === 0 &&
                index > 0
              ) {
                event.preventDefault()
                remove(index - 1)
              } else if (
                event.key === "Delete" &&
                event.currentTarget.selectionEnd === part.text.length &&
                index + 1 < parts.length
              ) {
                event.preventDefault()
                remove(index + 1)
              }
            },
            ref: (node: HTMLInputElement | HTMLTextAreaElement | null) => {
              if (node) elements.current.set(index, node)
              else elements.current.delete(index)
            },
          }
          return multiline ? (
            <InputGroupTextarea
              key={index}
              {...(inputProps as React.ComponentProps<
                typeof InputGroupTextarea
              >)}
              rows={tokens.length ? 1 : undefined}
            />
          ) : (
            <InputGroupInput key={index} {...inputProps} />
          )
        })}
        <InputGroupAddon
          align={multiline && !tokens.length ? "block-end" : "inline-end"}
        >
          <SearchableSelect
            value=""
            items={options
              .filter((option) =>
                `${option.label} ${fieldTypeLabel(option.field.type)}`
                  .toLowerCase()
                  .includes(search.toLowerCase())
              )
              .map((option) => ({
                value: option.path,
                label: option.label,
                group: option.group,
                description: `${fieldTypeLabel(option.field.type)} · ${JSON.stringify(option.field.example)} — ${option.field.description}`,
              }))}
            search={{ onChange: setSearch, placeholder: "Search variables…" }}
            contentClassName="w-96"
            trigger={() => (
              <InputGroupButton
                aria-label="Insert variable"
                size="icon-xs"
                disabled={props.disabled}
              >
                <BracesIcon />
              </InputGroupButton>
            )}
            onChange={(path) => {
              const { start, end } = selection.current
              const token = `{{${path}}}`
              const next = value.slice(0, start) + token + value.slice(end)
              onValueChange(next)
              requestAnimationFrame(() => {
                const position = start + token.length
                const nextParts = referenceParts(next)
                const index = nextParts.findIndex(
                  (part) =>
                    !part.path && position >= part.start && position <= part.end
                )
                const element = elements.current.get(index)
                element?.focus()
                element?.setSelectionRange(
                  position - nextParts[index].start,
                  position - nextParts[index].start
                )
              })
            }}
          />
        </InputGroupAddon>
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
