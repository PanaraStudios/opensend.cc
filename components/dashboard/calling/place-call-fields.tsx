"use client"
import { useCallback, useId, useState } from "react"
import { api } from "@/convex/_generated/api"
import { pickerSelectedIds } from "@/lib/dashboard/options"
import { useResourceOptions } from "@/components/dashboard/resource-picker"
import {
  OptionSelect,
  ListPagination,
  useTeamList,
} from "@/components/dashboard/primitives"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { PlusIcon, XIcon } from "lucide-react"

export type PlaceCallConfig = {
  accountId: string
  route: string
  purpose: string
  variables: Record<string, string>
  requestPermission: boolean
}
export function PlaceCallFields({
  config,
  onChange,
  disabled = false,
}: {
  config: PlaceCallConfig
  onChange: (config: PlaceCallConfig) => void
  disabled?: boolean
}) {
  const id = useId()
  const accounts = useTeamList(
    api.meta.connect.listAccounts,
    api.meta.connect.countAccounts,
    { channel: "whatsapp" }
  )
  const routeId = config.route.startsWith("bot:")
    ? config.route.slice(4)
    : config.route.startsWith("ivr:")
      ? config.route.slice(4)
      : ""
  const { rows: botRows, setSearch: setBotSearch } = useResourceOptions(
    api.voice.resources.botOptions,
    {
      selectedIds: pickerSelectedIds(
        config.route.startsWith("bot:") ? [routeId] : []
      ),
    }
  )
  const { rows: ivrRows, setSearch: setIvrSearch } = useResourceOptions(
    api.ivr.definitions.options,
    {
      selectedIds: pickerSelectedIds(
        config.route.startsWith("ivr:") ? [routeId] : []
      ),
    }
  )
  const onRouteSearch = useCallback(
    (value: string) => {
      setBotSearch(value)
      setIvrSearch(value)
    },
    [setBotSearch, setIvrSearch]
  )
  const botItems = (botRows ?? []).map((bot) => ({
    value: `bot:${bot.id}`,
    label: bot.name,
    group: "Voice bots",
  }))
  const ivrItems = (ivrRows ?? []).map((ivr) => ({
    value: `ivr:${ivr.id}`,
    label: ivr.name,
    group: "IVRs",
  }))
  const [variableName, setVariableName] = useState("")
  const update = (patch: Partial<PlaceCallConfig>) =>
    onChange({ ...config, ...patch })
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${id}-number`}>WhatsApp number</FieldLabel>
        <OptionSelect
          id={`${id}-number`}
          value={config.accountId}
          disabled={disabled}
          items={accounts.pageRows
            .filter((account) => account.status === "active")
            .map((account) => ({
              value: account._id,
              label: `${account.displayName || account.businessName} · ${account.handle}`,
            }))}
          onChange={(accountId) => update({ accountId })}
          placeholder="Choose a number"
        />
        <ListPagination {...accounts.pagination} embedded noun="number" />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-route`}>Bot or IVR</FieldLabel>
        <OptionSelect
          id={`${id}-route`}
          value={config.route}
          disabled={disabled}
          items={[...botItems, ...ivrItems]}
          search={{
            onChange: onRouteSearch,
            placeholder: "Search bots and IVRs",
          }}
          onChange={(route) => update({ route })}
          placeholder="Choose a bot or IVR"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-purpose`}>Call purpose</FieldLabel>
        <Textarea
          id={`${id}-purpose`}
          value={config.purpose}
          disabled={disabled}
          maxLength={4000}
          onChange={(event) => update({ purpose: event.target.value })}
          placeholder="Follow up after the seminar and help book a coaching session."
        />
        <FieldDescription>
          The bot receives this purpose with its instructions and starts with
          its greeting.
        </FieldDescription>
      </Field>
      {Object.entries(config.variables).map(([key, value]) => (
        <Field key={key}>
          <FieldLabel htmlFor={`${id}-${key}`}>{key}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={`${id}-${key}`}
              value={value}
              disabled={disabled}
              maxLength={2000}
              onChange={(event) =>
                update({
                  variables: { ...config.variables, [key]: event.target.value },
                })
              }
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove ${key}`}
              disabled={disabled}
              onClick={() =>
                update({
                  variables: Object.fromEntries(
                    Object.entries(config.variables).filter(
                      ([name]) => name !== key
                    )
                  ),
                })
              }
            >
              <XIcon />
            </Button>
          </div>
        </Field>
      ))}
      <Field>
        <FieldLabel htmlFor={`${id}-variable`}>Prompt variables</FieldLabel>
        <div className="flex gap-2">
          <Input
            id={`${id}-variable`}
            value={variableName}
            disabled={disabled}
            onChange={(event) => setVariableName(event.target.value)}
            placeholder="Variable name"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Add prompt variable"
            disabled={
              disabled ||
              !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(variableName) ||
              Object.keys(config.variables).length >= 50
            }
            onClick={() => {
              update({
                variables: {
                  ...config.variables,
                  [variableName]: config.variables[variableName] ?? "",
                },
              })
              setVariableName("")
            }}
          >
            <PlusIcon />
          </Button>
        </div>
        <FieldDescription>
          Automations can use event.field or contact.properties.field as a
          variable value.
        </FieldDescription>
      </Field>
      <Field orientation="horizontal">
        <Switch
          id={`${id}-permission`}
          disabled={disabled}
          checked={config.requestPermission}
          onCheckedChange={(requestPermission) => update({ requestPermission })}
        />
        <FieldLabel htmlFor={`${id}-permission`}>
          Request permission if needed
        </FieldLabel>
        <FieldDescription>
          The contact must approve before a call is placed. Free-form requests
          need an open messaging window.
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}
