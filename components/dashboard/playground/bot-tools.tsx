"use client"
import { useState } from "react"
import { useAction } from "convex/react"
import { WrenchIcon } from "lucide-react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import type { BotTool } from "@/packages/sdk/src/voice/toolkit-types"
import {
  SectionChrome,
  ResourceTable,
  Th,
  EmptyState,
} from "@/components/dashboard/primitives"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { VoiceField, VoiceChoiceField } from "./ivr-fields"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { actionError } from "@/lib/action-error"
import { validateToolSchema, type ToolParameter } from "@/lib/bot-toolkit"
type ParameterRow = {
  name: string
  type: ToolParameter["type"]
  description: string
  required: boolean
  enum?: ToolParameter["enum"]
}
export function BotToolsList() {
  const [after, setAfter] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([])
  const list = useTeamQuery(api.botTools.resources.dashboardList, {
    limit: 25,
    after,
  }) as { data: BotTool[]; has_more: boolean } | undefined
  const { activeTeamId } = useWorkspace(),
    write = useAction(api.botTools.resources.dashboardWrite)
  const [editing, setEditing] = useState<BotTool | "new">(),
    [testing, setTesting] = useState<BotTool>(),
    [deleting, setDeleting] = useState<BotTool>(),
    [error, setError] = useState("")
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={<Button onClick={() => setEditing("new")}>Create tool</Button>}
    >
      {!list ? (
        <Skeleton className="h-40 w-full" />
      ) : !list.data.length ? (
        <EmptyState
          icon={WrenchIcon}
          title="No webhook tools"
          description="Let your voice bots call your systems through signed HTTPS requests."
        >
          <Button onClick={() => setEditing("new")}>Create tool</Button>
        </EmptyState>
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th>Endpoint</Th>
              <Th>Actions</Th>
            </>
          }
        >
          {list.data.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>{row.description}</TableCell>
              <TableCell className="max-w-xs truncate">
                {row.method} {row.url}
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setTesting(row)}
                  >
                    Send test request
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleting(row)}
                  >
                    Delete
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </ResourceTable>
      )}
      {list?.data.length ? (
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!history.length}
            onClick={() => {
              setAfter(history.at(-1))
              setHistory(history.slice(0, -1))
            }}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={!list.has_more}
            onClick={() => {
              setHistory([...history, after])
              setAfter(list.data.at(-1)?.id)
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined)
        }}
      >
        {editing ? (
          <ToolDialog
            row={editing === "new" ? undefined : editing}
            close={() => setEditing(undefined)}
          />
        ) : null}
      </Dialog>
      <Dialog
        open={!!testing}
        onOpenChange={(open) => {
          if (!open) setTesting(undefined)
        }}
      >
        {testing ? (
          <ToolTest row={testing} close={() => setTesting(undefined)} />
        ) : null}
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>
              Bots will no longer be able to use this tool.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  await write({
                    organizationId: activeTeamId!,
                    id: deleting!.id,
                    remove: true,
                    body: "{}",
                  })
                  setDeleting(undefined)
                } catch (e) {
                  setError(actionError(e))
                  setDeleting(undefined)
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionChrome>
  )
}
function ToolDialog({ row, close }: { row?: BotTool; close: () => void }) {
  const { activeTeamId } = useWorkspace(),
    write = useAction(api.botTools.resources.dashboardWrite)
  const [name, setName] = useState(row?.name ?? ""),
    [description, setDescription] = useState(row?.description ?? ""),
    [url, setUrl] = useState(row?.url ?? ""),
    [method, setMethod] = useState(row?.method ?? "POST"),
    [timeout, setTimeoutValue] = useState(String(row?.timeoutMs ?? 10000)),
    [resultFields, setResultFields] = useState(
      row?.resultFields?.join(", ") ?? ""
    ),
    [secret, setSecret] = useState(""),
    [headers, setHeaders] = useState<{ name: string; value: string }[]>([]),
    [replaceHeaders, setReplaceHeaders] = useState(!row)
  const [parameters, setParameters] = useState<ParameterRow[]>(
      Object.entries(row?.parameters.properties ?? {}).map(([name, p]) => ({
        name,
        type: p.type,
        description: p.description ?? "",
        required: row?.parameters.required?.includes(name) ?? false,
        ...(p.enum ? { enum: p.enum } : {}),
      }))
    ),
    [advanced, setAdvanced] = useState(false),
    [json, setJson] = useState(
      JSON.stringify(
        row?.parameters ?? {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
        null,
        2
      )
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false)
  function schemaFromRows() {
    const names = parameters.map((p) => p.name)
    if (new Set(names).size !== names.length)
      throw new Error("Parameter names must be unique")
    return validateToolSchema({
      type: "object",
      properties: Object.fromEntries(
        parameters.map((p) => [
          p.name,
          {
            type: p.type,
            ...(p.description ? { description: p.description } : {}),
            ...(p.enum ? { enum: p.enum } : {}),
          },
        ])
      ),
      required: parameters.filter((p) => p.required).map((p) => p.name),
      additionalProperties: false,
    })
  }
  const patchParameter = (i: number, patch: Partial<ParameterRow>) =>
    setParameters((rows) =>
      rows.map((p, index) => (i === index ? { ...p, ...patch } : p))
    )
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {row ? "Edit webhook tool" : "Create webhook tool"}
        </DialogTitle>
        <DialogDescription>
          Your bot sends signed requests to this public HTTPS endpoint.
          Credentials are encrypted and write-only.
        </DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError("")
          try {
            const schema = advanced
              ? validateToolSchema(JSON.parse(json))
              : schemaFromRows()
            const headerNames = headers.map((h) => h.name.toLowerCase())
            if (new Set(headerNames).size !== headerNames.length)
              throw new Error("Header names must be unique")
            await write({
              organizationId: activeTeamId!,
              id: row?.id,
              body: JSON.stringify({
                name,
                description,
                url,
                method,
                parameters: schema,
                timeoutMs: Number(timeout),
                ...(replaceHeaders
                  ? {
                      headers: Object.fromEntries(
                        headers.map((h) => [h.name, h.value])
                      ),
                    }
                  : {}),
                ...(secret ? { signingSecret: secret } : {}),
                resultFields: resultFields.trim()
                  ? resultFields
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : undefined,
              }),
            })
            close()
          } catch (e) {
            setError(actionError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <VoiceField
          label="Tool name (snake_case)"
          value={name}
          onChange={setName}
        />
        <VoiceField
          label="What does this tool do?"
          value={description}
          onChange={setDescription}
        />
        <div className="flex items-center justify-between">
          <FieldLabel>Parameters</FieldLabel>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setError("")
              try {
                if (advanced) {
                  const parsed = validateToolSchema(JSON.parse(json))
                  setParameters(
                    Object.entries(parsed.properties).map(([name, p]) => ({
                      name,
                      type: p.type,
                      description: p.description ?? "",
                      required: parsed.required.includes(name),
                      ...(p.enum ? { enum: p.enum } : {}),
                    }))
                  )
                } else setJson(JSON.stringify(schemaFromRows(), null, 2))
                setAdvanced(!advanced)
              } catch (e) {
                setError(actionError(e))
              }
            }}
          >
            {advanced ? "Use builder" : "Advanced JSON"}
          </Button>
        </div>
        {advanced ? (
          <Textarea
            aria-label="Parameters JSON Schema"
            className="min-h-48 font-mono text-xs"
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
        ) : (
          <>
            {parameters.map((p, i) => (
              <div key={i} className="flex flex-col gap-3 border-t pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <VoiceField
                    label="Parameter name"
                    value={p.name}
                    onChange={(name) => patchParameter(i, { name })}
                  />
                  <VoiceChoiceField
                    label="Parameter type"
                    value={p.type}
                    items={[
                      { value: "string", label: "Text" },
                      { value: "number", label: "Number" },
                      { value: "boolean", label: "Yes / No" },
                    ]}
                    onChange={(type) =>
                      patchParameter(i, {
                        type: type as ParameterRow["type"],
                        enum: undefined,
                      })
                    }
                  />
                </div>
                <VoiceField
                  label="Parameter description"
                  value={p.description}
                  onChange={(description) => patchParameter(i, { description })}
                />
                <div className="flex items-center justify-between">
                  <Field orientation="horizontal">
                    <FieldLabel>Required</FieldLabel>
                    <Switch
                      aria-label={`Require parameter ${i + 1}`}
                      checked={p.required}
                      onCheckedChange={(required) =>
                        patchParameter(i, { required })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setParameters(
                        parameters.filter((_, index) => index !== i)
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={parameters.length >= 32}
              onClick={() =>
                setParameters([
                  ...parameters,
                  {
                    name: "",
                    type: "string",
                    description: "",
                    required: false,
                  },
                ])
              }
            >
              Add parameter
            </Button>
          </>
        )}
        <VoiceField label="Public HTTPS URL" value={url} onChange={setUrl} />
        <VoiceChoiceField
          label="Request method"
          value={method}
          items={["POST", "GET", "PUT", "PATCH", "DELETE"].map((value) => ({
            value,
            label: value,
          }))}
          onChange={(value) => setMethod(value as typeof method)}
        />
        <VoiceField
          label="Timeout (milliseconds, up to 10,000)"
          value={timeout}
          type="number"
          onChange={setTimeoutValue}
        />
        {row ? (
          <Field orientation="horizontal">
            <FieldLabel>Replace saved headers</FieldLabel>
            <Switch
              aria-label="Replace saved headers"
              checked={replaceHeaders}
              onCheckedChange={setReplaceHeaders}
            />
          </Field>
        ) : (
          <FieldLabel>Request headers</FieldLabel>
        )}
        {replaceHeaders ? (
          <>
            {headers.map((h, i) => (
              <div key={i} className="flex flex-col gap-3 border-t pt-3">
                <VoiceField
                  label="Header name"
                  value={h.name}
                  onChange={(name) =>
                    setHeaders(
                      headers.map((p, index) =>
                        i === index ? { ...p, name } : p
                      )
                    )
                  }
                />
                <VoiceField
                  label="Secret header value"
                  type="password"
                  value={h.value}
                  onChange={(value) =>
                    setHeaders(
                      headers.map((p, index) =>
                        i === index ? { ...p, value } : p
                      )
                    )
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setHeaders(headers.filter((_, index) => i !== index))
                  }
                >
                  Remove header
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={headers.length >= 16}
              onClick={() => setHeaders([...headers, { name: "", value: "" }])}
            >
              Add header
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Saved headers are retained. Enable replacement to change or clear
            them.
          </p>
        )}
        <VoiceField
          label={
            row
              ? "Replace signing secret (leave blank to keep)"
              : "Signing secret (optional, at least 32 characters)"
          }
          type="password"
          value={secret}
          onChange={setSecret}
        />
        <p className="text-xs text-muted-foreground">
          Set a shared secret here and on your endpoint to verify svix-id,
          svix-timestamp and svix-signature. An omitted secret is generated
          privately.
        </p>
        <VoiceField
          label="Response fields visible to bot (optional, comma-separated)"
          value={resultFields}
          onChange={setResultFields}
        />
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? "Saving…" : row ? "Save" : "Create tool"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
function ToolTest({ row, close }: { row: BotTool; close: () => void }) {
  const { activeTeamId } = useWorkspace(),
    test = useAction(api.botTools.execute.dashboardTest)
  const [sample, setSample] = useState(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row.parameters.properties).map(([key, p]) => [
            key,
            p.enum?.[0] ??
              (p.type === "number" ? 0 : p.type === "boolean" ? false : ""),
          ])
        ),
        null,
        2
      )
    ),
    [result, setResult] = useState<{
      ok: boolean
      result?: unknown
      error?: string
      latencyMs: number
    }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false)
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Test {row.name}</DialogTitle>
        <DialogDescription>
          This sends a real signed request and may change data in your system.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel>Sample arguments</FieldLabel>
        <Textarea
          aria-label="Sample arguments"
          className="min-h-40 font-mono text-xs"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
      </Field>
      {result ? (
        <div>
          <p className="text-sm font-medium">
            {result.ok ? "Succeeded" : "Failed"} · {result.latencyMs} ms
          </p>
          {result.error ? (
            <p role="alert" className="text-sm text-destructive">
              {result.error}
            </p>
          ) : (
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
              {JSON.stringify(result.result, null, 2)}
            </pre>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          Close
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setError("")
            setResult(undefined)
            setBusy(true)
            try {
              const response = await test({
                organizationId: activeTeamId!,
                id: row.id,
                input: JSON.parse(sample),
              })
              setResult(
                response as {
                  ok: boolean
                  result?: unknown
                  error?: string
                  latencyMs: number
                }
              )
            } catch (e) {
              setError(actionError(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "Sending…" : "Send test request"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
