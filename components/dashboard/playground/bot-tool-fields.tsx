"use client"
import { useState } from "react"
import { useMutation } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { VoiceField, VoiceChoiceField } from "./ivr-fields"
import { validateCollect, type CollectField } from "@/lib/bot-toolkit"
import type { VoiceBotConfig } from "@/lib/voice-bots"
import type { KnowledgeBase, BotTool } from "@/packages/sdk/src/voice/toolkit"
import { actionError } from "@/lib/action-error"
const TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Yes / No" },
  { value: "email", label: "Email address" },
  { value: "phone", label: "Phone number" },
  { value: "date", label: "Date" },
  { value: "enum", label: "Choice" },
]
export function BotAttachments({
  config,
  onChange,
  kind,
}: {
  config: VoiceBotConfig
  onChange: (patch: Partial<VoiceBotConfig>) => void
  kind: "knowledge" | "tools"
}) {
  const bases = useTeamQuery(
    api.knowledge.resources.dashboardList,
    { limit: 100 },
    { enabled: kind === "knowledge" }
  ) as { data: KnowledgeBase[]; has_more: boolean } | undefined
  const tools = useTeamQuery(
    api.botTools.resources.dashboardList,
    { limit: 100 },
    { enabled: kind === "tools" }
  ) as { data: BotTool[]; has_more: boolean } | undefined
  const key = kind === "knowledge" ? "knowledgeBaseIds" : "customToolIds",
    list = kind === "knowledge" ? bases : tools
  return (
    <div className="flex flex-col gap-3">
      {!list ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !list.data.length ? (
        <p className="text-sm text-muted-foreground">
          Create {kind === "knowledge" ? "knowledge bases" : "webhook tools"} in
          Playground to attach them here.
        </p>
      ) : (
        list.data.map((row) => (
          <Field key={row.id} orientation="horizontal">
            <FieldLabel>{row.name}</FieldLabel>
            <Switch
              aria-label={`Attach ${row.name}`}
              checked={config[key]?.includes(row.id) ?? false}
              onCheckedChange={(checked) =>
                onChange({
                  [key]: checked
                    ? [...(config[key] ?? []), row.id]
                    : (config[key]?.filter((id) => id !== row.id) ?? []),
                })
              }
            />
          </Field>
        ))
      )}
      {list?.has_more ? (
        <p className="text-sm text-muted-foreground">
          Showing the latest 100 resources. Use the API to attach older
          resources by ID.
        </p>
      ) : null}
    </div>
  )
}
export function CollectFields({
  fields,
  onChange,
}: {
  fields: CollectField[]
  onChange: (fields: CollectField[]) => void
}) {
  const [editing, setEditing] = useState<number>()
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, i) => (
        <div
          key={field.key}
          className="flex items-center justify-between gap-2"
        >
          <div>
            <p className="text-sm font-medium">
              {field.label}
              {field.required ? " · Required" : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {TYPES.find((t) => t.value === field.type)?.label}
            </p>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(fields.filter((_, index) => index !== i))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={fields.length >= 32}
        onClick={() => setEditing(fields.length)}
      >
        Add field
      </Button>
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined)
        }}
      >
        {editing !== undefined ? (
          <FieldDialog
            key={editing}
            row={fields[editing]}
            others={fields.filter((_, i) => i !== editing)}
            close={() => setEditing(undefined)}
            save={(field) => {
              const next = [...fields]
              next[editing] = field
              onChange(next)
              setEditing(undefined)
            }}
          />
        ) : null}
      </Dialog>
    </div>
  )
}
function FieldDialog({
  row,
  others,
  save,
  close,
}: {
  row?: CollectField
  others: CollectField[]
  save: (field: CollectField) => void
  close: () => void
}) {
  const [field, setField] = useState<CollectField>(
      row ?? {
        key: "",
        label: "",
        description: "",
        type: "text",
        required: false,
      }
    ),
    [options, setOptions] = useState(row?.options?.join("\n") ?? ""),
    [creating, setCreating] = useState(false),
    [propertyName, setPropertyName] = useState(""),
    [propertyKey, setPropertyKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  const properties = useTeamQuery(api.contactProperties.definitions),
    { activeTeamId } = useWorkspace(),
    createProperty = useMutation(api.contactProperties.create)
  const patch = (value: Partial<CollectField>) =>
    setField((f) => ({ ...f, ...value }))
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {row ? "Edit collection field" : "Add collection field"}
        </DialogTitle>
        <DialogDescription>
          Your bot asks for this information naturally and saves it on the call.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setError("")
          setBusy(true)
          try {
            const next = {
              ...field,
              ...(field.type === "enum"
                ? {
                    options: options
                      .split("\n")
                      .map((o) => o.trim())
                      .filter(Boolean),
                  }
                : {}),
            }
            if (creating) next.contactProperty = propertyKey
            validateCollect([...others, next])
            if (creating)
              await createProperty({
                organizationId: activeTeamId!,
                key: propertyKey,
                name: propertyName,
                type: field.type === "number" ? "number" : "string",
              })
            save(next)
          } catch (e) {
            setError(actionError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <VoiceField
          label="Label"
          value={field.label}
          onChange={(label) => patch({ label })}
        />
        <VoiceField
          label="Field key (snake_case)"
          value={field.key}
          onChange={(key) => patch({ key })}
        />
        <VoiceField
          label="What should the bot ask?"
          value={field.description}
          onChange={(description) => patch({ description })}
        />
        <VoiceChoiceField
          label="Type"
          value={field.type}
          items={TYPES}
          onChange={(type) =>
            patch({
              type: type as CollectField["type"],
              options: undefined,
              contactProperty: undefined,
            })
          }
        />
        {field.type === "enum" ? (
          <VoiceField
            label="Choices (separate with a comma)"
            value={options.replace(/\n/g, ", ")}
            onChange={(value) =>
              setOptions(
                value
                  .split(",")
                  .map((v) => v.trim())
                  .join("\n")
              )
            }
          />
        ) : null}
        <Field orientation="horizontal">
          <FieldLabel>Required</FieldLabel>
          <Switch
            aria-label="Required field"
            checked={field.required}
            onCheckedChange={(required) => patch({ required })}
          />
        </Field>
        <VoiceChoiceField
          label="Save to contact property"
          value={creating ? "create" : (field.contactProperty ?? "none")}
          items={[
            { value: "none", label: "Call record only" },
            ...(properties ?? [])
              .filter((p) => p.type === "string" || field.type === "number")
              .map((p) => ({ value: p.key, label: p.name })),
            { value: "create", label: "Create new property…" },
          ]}
          onChange={(value) => {
            setCreating(value === "create")
            patch({
              contactProperty:
                value === "none" || value === "create" ? undefined : value,
            })
          }}
        />
        {creating ? (
          <>
            <VoiceField
              label="Property name"
              value={propertyName}
              onChange={setPropertyName}
            />
            <VoiceField
              label="Property key"
              value={propertyKey}
              onChange={setPropertyKey}
            />
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy}>{busy ? "Saving…" : "Done"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
