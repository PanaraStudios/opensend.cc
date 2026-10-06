"use client"
import { useId, useState } from "react"
import type { FunctionReference } from "convex/server"
import { useTeamQuery } from "@/components/auth/workspace"
import { pickerSelectedIds } from "@/lib/dashboard/options"
import type { VoiceProvider } from "@/lib/voice-bots"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  OptionSelect,
  useDebouncedValue,
  type SelectOption,
} from "./primitives"

type PickerArgs = {
  search?: string
  selectedIds?: string[]
  selectedNames?: string[]
  provider?: VoiceProvider
}
type PickerQuery<Result> = FunctionReference<
  "query",
  "public",
  { organizationId: string } & PickerArgs,
  Result
>
type NamedRow = {
  id: string
  name?: string
  label?: string
  lastFour?: string
}

/** Search text for a server-backed picker. The select debounces before calling
    `setSearch`, so this hook queries the paused value directly. */
export function useResourceOptions<Result>(
  query: PickerQuery<Result>,
  args?: Omit<PickerArgs, "search">,
  options?: { enabled?: boolean }
) {
  const [search, setSearch] = useState("")
  const needle = search.trim()
  const rows = useTeamQuery(
    query,
    needle ? { ...args, search: needle } : { ...args },
    options
  )
  return { rows, setSearch }
}

function optionLabel(row: NamedRow) {
  if (row.name) return row.name
  if (row.label && row.lastFour) return `${row.label} · ••••${row.lastFour}`
  if (row.label) return row.label
  return "Saved item"
}

/** One searchable select over a bounded server options query. The saved value
    is loaded with the page, so a choice past the first suggestions stays. */
export function ResourceSelect<Result extends readonly NamedRow[]>({
  query,
  args,
  value,
  onChange,
  label,
  placeholder,
  extraItems,
  id,
  disabled,
}: {
  query: PickerQuery<Result>
  args?: Omit<PickerArgs, "search" | "selectedIds">
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  extraItems?: readonly SelectOption[]
  id?: string
  disabled?: boolean
}) {
  const { rows, setSearch } = useResourceOptions(query, {
    ...args,
    selectedIds: pickerSelectedIds([value]),
  })
  const items = [
    ...(rows ?? []).map((row) => ({
      value: row.id,
      label: optionLabel(row),
    })),
    ...(extraItems ?? []),
  ]
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <OptionSelect
        id={id}
        aria-label={label}
        placeholder={placeholder ?? `Choose ${label.toLowerCase()}`}
        value={value}
        disabled={disabled}
        items={items}
        search={{
          onChange: setSearch,
          placeholder: `Search ${label.toLowerCase()}`,
        }}
        onChange={onChange}
      />
    </Field>
  )
}

/** Switches for a multi-select picker. Search hits the same options query,
    and saved ids stay in the list so a later page can still be cleared. */
export function ResourceChecks({
  query,
  selectedIds,
  onChange,
  noun,
  empty,
}: {
  query: PickerQuery<readonly { id: string; name: string }[]>
  selectedIds: readonly string[]
  onChange: (ids: string[]) => void
  noun: string
  empty: string
}) {
  const id = useId()
  const [text, setText] = useState("")
  const needle = useDebouncedValue(text).trim()
  const rows = useTeamQuery(query, {
    selectedIds: pickerSelectedIds(selectedIds),
    ...(needle ? { search: needle } : {}),
  })
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field>
        <FieldLabel htmlFor={id}>Search {noun}</FieldLabel>
        <Input
          id={id}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Search ${noun}`}
        />
      </Field>
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">
          {needle ? `No ${noun} match that search.` : empty}
        </p>
      ) : (
        rows.map((row) => (
          <Field key={row.id} orientation="horizontal" className="min-w-0">
            <FieldLabel className="max-w-full min-w-0 break-words">
              {row.name}
            </FieldLabel>
            <Switch
              aria-label={`Attach ${row.name}`}
              checked={selectedIds.includes(row.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? selectedIds.includes(row.id)
                      ? [...selectedIds]
                      : [...selectedIds, row.id]
                    : selectedIds.filter((current) => current !== row.id)
                )
              }
            />
          </Field>
        ))
      )}
    </div>
  )
}
