"use client"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAction } from "convex/react"
import { BotIcon } from "lucide-react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  SectionChrome,
  DocsButton,
  DetailHeader,
  DetailSection,
  MetaStrip,
  EmptyState,
  ResourceTable,
  Th,
  RelativeTime,
  OptionSelect,
  TypeToConfirmDialog,
} from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FieldLabel, FieldError } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { actionError } from "@/lib/action-error"
import {
  newVoiceBot,
  voiceBotFormPayload,
  type VoiceBotResource,
  type VoiceProviderResource,
} from "@/lib/dashboard/voice-bot-form"
import {
  VOICE_STAGE_MODELS,
  GEMINI_LIVE_MODELS,
  VOICE_BOT_TOOLS,
  type VoiceBotConfig,
  type VoiceProvider,
  type VoiceStage,
} from "@/lib/voice-bots"
import { VoiceField } from "./ivr-fields"
import { VoiceRouting } from "./routing"
import { VoiceTester } from "./tester"
import { ProviderKeys } from "./provider-keys"

export function VoiceBotList() {
  const [after, setAfter] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([])
  const list: { data: VoiceBotResource[]; has_more: boolean } | undefined =
    useTeamQuery(api.voice.resources.dashboardList, { limit: 25, after }) as
      { data: VoiceBotResource[]; has_more: boolean } | undefined
  const setup = useTeamQuery(api.calling.playgroundState.setup)
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={
        <>
          <Button
            nativeButton={false}
            render={<Link href="/playground/voice-bot/new" />}
          >
            Create voice bot
          </Button>
          <DocsButton href="https://github.com/PanaraStudios/opensend.cc/blob/v2/docs/voice-bots.md" />
        </>
      }
    >
      {!list ? (
        <Skeleton className="h-40 w-full" />
      ) : !list.data.length ? (
        <EmptyState
          icon={BotIcon}
          title="No voice bots"
          description="Configure a provider key, build a bot and test it from your browser."
        >
          <Button
            nativeButton={false}
            render={<Link href="/playground/voice-bot/new" />}
          >
            Create voice bot
          </Button>
        </EmptyState>
      ) : (
        <>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Engine</Th>
                <Th>Language</Th>
                <Th>Assigned numbers</Th>
                <Th>Updated</Th>
              </>
            }
          >
            {list.data.map((bot) => (
              <TableRow key={bot.id}>
                <TableCell>
                  <Link
                    className="font-medium hover:underline"
                    href={`/playground/voice-bot/${bot.id}`}
                  >
                    {bot.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {bot.engine === "gemini_live"
                    ? "Gemini Live"
                    : "Cascade: STT → LLM → TTS"}
                </TableCell>
                <TableCell>{bot.language}</TableCell>
                <TableCell>
                  {setup?.numbers
                    .filter((n) => n.routing === `bot:${bot.id}`)
                    .map((n) => n.label)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell>
                  <RelativeTime at={bot.updatedAt} />
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <div className="flex justify-end gap-2">
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
        </>
      )}
      <ProviderKeys />
    </SectionChrome>
  )
}
export function VoiceBotEditor({ id }: { id?: string }) {
  const row: VoiceBotResource | undefined = useTeamQuery(
    api.voice.resources.dashboardGet,
    { id: id ?? "" },
    { enabled: !!id }
  ) as VoiceBotResource | undefined
  if (id && !row) return <Skeleton className="h-60 w-full" />
  return <BotForm key={id ?? "new"} row={row} />
}
function StageFields({
  name,
  stage,
  onChange,
  keys,
}: {
  name: "stt" | "llm" | "tts"
  stage: VoiceStage
  onChange: (stage: VoiceStage) => void
  keys: VoiceProviderResource[]
}) {
  const models = VOICE_STAGE_MODELS[name] as Partial<
    Record<VoiceProvider, readonly string[]>
  >
  return (
    <DetailSection title={name.toUpperCase()}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field>
          <FieldLabel>Provider</FieldLabel>
          <OptionSelect
            aria-label={`${name} provider`}
            value={stage.provider}
            items={Object.keys(models).map((value) => ({
              value,
              label: value,
            }))}
            onChange={(provider) =>
              onChange({
                ...stage,
                provider: provider as VoiceProvider,
                model: models[provider as VoiceProvider]![0],
                credentialId: "",
                ...(name === "tts"
                  ? { voice: provider === "sarvam" ? "shubh" : "" }
                  : {}),
              })
            }
          />
        </Field>
        <Field>
          <FieldLabel>Model</FieldLabel>
          <OptionSelect
            aria-label={`${name} model`}
            value={stage.model}
            items={(models[stage.provider] ?? []).map((value) => ({
              value,
              label: value,
            }))}
            onChange={(model) => onChange({ ...stage, model })}
          />
        </Field>
        <Field>
          <FieldLabel>Key</FieldLabel>
          <OptionSelect
            aria-label={`${name} key`}
            placeholder="Choose provider key"
            value={stage.credentialId}
            items={keys
              .filter((k) => k.provider === stage.provider)
              .map((k) => ({
                value: k.id,
                label: `${k.label} · ••••${k.lastFour}`,
              }))}
            onChange={(credentialId) => onChange({ ...stage, credentialId })}
          />
        </Field>
      </div>
      {name === "stt" ? (
        <VoiceField
          label="STT language (auto detects)"
          value={stage.language ?? "auto"}
          onChange={(language) => onChange({ ...stage, language })}
        />
      ) : name === "tts" ? (
        <VoiceField
          label="TTS voice"
          value={stage.voice ?? ""}
          onChange={(voice) => onChange({ ...stage, voice })}
        />
      ) : null}
    </DetailSection>
  )
}
function BotForm({ row }: { row?: VoiceBotResource }) {
  const router = useRouter(),
    { activeTeamId } = useWorkspace()
  const [draft, setDraft] = useState<VoiceBotConfig>(() =>
    row ? voiceBotFormPayload(row) : newVoiceBot()
  )
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [deleting, setDeleting] = useState(false)
  const keys: { data: VoiceProviderResource[] } | undefined = useTeamQuery(
    api.voice.resources.dashboardList,
    { limit: 100, providers: true }
  ) as { data: VoiceProviderResource[] } | undefined
  const ivrs: { data: { id: string; name: string }[] } | undefined =
    useTeamQuery(api.ivr.definitions.dashboardList, { limit: 100 })
  const write = useAction(api.voice.resources.dashboardWrite)
  const patch = (p: Partial<VoiceBotConfig>) => setDraft({ ...draft, ...p })
  async function save() {
    setBusy(true)
    setError("")
    try {
      const result = await write({
        organizationId: activeTeamId!,
        kind: "bot",
        id: row?.id,
        body: JSON.stringify(voiceBotFormPayload(draft)),
      })
      toast.add({ type: "success", title: "Voice bot saved" })
      if (!row) router.push(`/playground/voice-bot/${result.id}`)
    } catch (e) {
      setError(actionError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <DetailHeader
        backHref="/playground/voice-bot"
        backLabel="Voice bots"
        title={row?.name ?? "Create voice bot"}
        icon={BotIcon}
        actions={
          <>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {row ? (
              <Button variant="destructive" onClick={() => setDeleting(true)}>
                Delete
              </Button>
            ) : null}
          </>
        }
      />
      {row ? (
        <MetaStrip
          items={[
            { label: "ID", value: row.id },
            {
              label: "Engine",
              value: row.engine === "gemini_live" ? "Gemini Live" : "Cascade",
            },
          ]}
        />
      ) : null}
      {!keys ? (
        <Skeleton className="h-20 w-full" />
      ) : !keys.data.length ? (
        <p className="text-sm text-muted-foreground">
          Add a provider key on the{" "}
          <Link
            href="/playground/voice-bot"
            className="font-medium hover:underline"
          >
            Voice bot tab
          </Link>{" "}
          before saving.
        </p>
      ) : null}
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {error ? <FieldError role="alert">{error}</FieldError> : null}
        <DetailSection title="Basics">
          <div className="grid gap-4 sm:grid-cols-2">
            <VoiceField
              label="Name"
              value={draft.name}
              onChange={(name) => patch({ name })}
            />
            <VoiceField
              label="Language"
              value={draft.language}
              onChange={(language) => patch({ language })}
            />
          </div>
        </DetailSection>
        <DetailSection title="Engine">
          <OptionSelect
            aria-label="Engine"
            value={draft.engine}
            items={[
              { value: "gemini_live", label: "Gemini Live" },
              { value: "cascade", label: "Cascade: STT → LLM → TTS" },
            ]}
            onChange={(engine) =>
              setDraft({
                ...newVoiceBot(engine as VoiceBotConfig["engine"]),
                name: draft.name,
                systemPrompt: draft.systemPrompt,
                greeting: draft.greeting,
                disclosure: draft.disclosure,
                tools: draft.tools,
                handoff: draft.handoff,
              })
            }
          />
          <Field>
            <FieldLabel>
              {draft.engine === "gemini_live"
                ? "Gemini key"
                : "Primary Sarvam key"}
            </FieldLabel>
            <OptionSelect
              aria-label="Primary provider key"
              value={draft.credentialId}
              placeholder="Choose provider key"
              items={(keys?.data ?? [])
                .filter((k) => k.provider === draft.provider)
                .map((k) => ({
                  value: k.id,
                  label: `${k.label} · ••••${k.lastFour}`,
                }))}
              onChange={(credentialId) =>
                patch({
                  credentialId,
                  ...(draft.engine === "cascade"
                    ? {
                        stt: {
                          ...draft.stt!,
                          credentialId: draft.stt?.credentialId || credentialId,
                        },
                        llm: {
                          ...draft.llm!,
                          credentialId: draft.llm?.credentialId || credentialId,
                        },
                        tts: {
                          ...draft.tts!,
                          credentialId: draft.tts?.credentialId || credentialId,
                        },
                      }
                    : {}),
                })
              }
            />
          </Field>
          {draft.engine === "gemini_live" ? (
            <>
              <OptionSelect
                aria-label="Gemini model"
                value={draft.model}
                items={GEMINI_LIVE_MODELS.map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(model) => patch({ model })}
              />
              <VoiceField
                label="Gemini voice"
                value={draft.voice}
                onChange={(voice) => patch({ voice })}
              />
            </>
          ) : (
            (["stt", "llm", "tts"] as const).map((name) => (
              <StageFields
                key={name}
                name={name}
                stage={draft[name]!}
                keys={keys?.data ?? []}
                onChange={(stage) => patch({ [name]: stage })}
              />
            ))
          )}
        </DetailSection>
        <DetailSection title="Behavior">
          <Field>
            <FieldLabel>System prompt</FieldLabel>
            <Textarea
              aria-label="System prompt"
              value={draft.systemPrompt}
              onChange={(e) => patch({ systemPrompt: e.target.value })}
            />
          </Field>
          <VoiceField
            label="Greeting"
            value={draft.greeting}
            onChange={(greeting) => patch({ greeting })}
          />
          <VoiceField
            label="AI disclosure"
            value={draft.disclosure}
            onChange={(disclosure) => patch({ disclosure })}
          />
          <ResourceTable
            headers={
              <>
                <Th>Enabled</Th>
                <Th>Tool</Th>
                <Th>Behavior</Th>
              </>
            }
          >
            {Object.entries(VOICE_BOT_TOOLS).map(([name, tool]) => (
              <TableRow key={name}>
                <TableCell>
                  <Checkbox
                    aria-label={`Enable ${name}`}
                    checked={draft.tools.includes(
                      name as (typeof draft.tools)[number]
                    )}
                    onCheckedChange={(enabled) =>
                      patch({
                        tools: enabled
                          ? [
                              ...draft.tools,
                              name as (typeof draft.tools)[number],
                            ]
                          : draft.tools.filter((t) => t !== name),
                      })
                    }
                  />
                </TableCell>
                <TableCell>{name}</TableCell>
                <TableCell className="whitespace-normal">
                  {tool.description}
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
          <Field orientation="horizontal">
            <Switch
              aria-label="Allow agent handoff"
              checked={draft.handoff.agents}
              onCheckedChange={(agents) =>
                patch({ handoff: { ...draft.handoff, agents } })
              }
            />
            <FieldLabel>Allow agent handoff</FieldLabel>
          </Field>
          <OptionSelect
            aria-label="IVR handoff"
            value={draft.handoff.ivrId ?? "none"}
            items={[
              { value: "none", label: "No IVR handoff" },
              ...(ivrs?.data ?? []).map((r) => ({
                value: r.id,
                label: r.name,
              })),
            ]}
            onChange={(ivrId) =>
              patch({
                handoff: {
                  agents: draft.handoff.agents,
                  ...(ivrId === "none" ? {} : { ivrId }),
                },
              })
            }
          />
        </DetailSection>
        <DetailSection title="Limits">
          <div className="grid gap-4 sm:grid-cols-2">
            <VoiceField
              type="number"
              label="Max duration (seconds)"
              value={draft.maxDurationSeconds}
              onChange={(value) => patch({ maxDurationSeconds: Number(value) })}
            />
            <VoiceField
              type="number"
              label="Silence timeout (seconds)"
              value={draft.silenceTimeoutSeconds}
              onChange={(value) =>
                patch({ silenceTimeoutSeconds: Number(value) })
              }
            />
            <VoiceField
              type="number"
              label="Monthly minute budget (optional)"
              value={draft.monthlyMinuteBudget ?? ""}
              onChange={(value) =>
                patch({
                  monthlyMinuteBudget: value === "" ? undefined : Number(value),
                })
              }
            />
            <VoiceField
              type="number"
              label="Max concurrent calls (optional)"
              value={draft.maxConcurrentCalls ?? ""}
              onChange={(value) =>
                patch({
                  maxConcurrentCalls: value === "" ? undefined : Number(value),
                })
              }
            />
          </div>
          <Field orientation="horizontal">
            <Switch
              aria-label="Record calls"
              checked={draft.recording}
              onCheckedChange={(recording) => patch({ recording })}
            />
            <FieldLabel>Record calls</FieldLabel>
          </Field>
        </DetailSection>
      </form>
      {row ? (
        <>
          <VoiceRouting kind="bot" id={row.id} />
          <VoiceTester kind="bot" id={row.id} />
        </>
      ) : null}
      {row ? (
        <TypeToConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete voice bot"
          phrase={row.name}
          description="Remove number routing and IVR references before deleting this bot."
          confirmLabel="Delete voice bot"
          onConfirm={async () => {
            await write({
              organizationId: activeTeamId!,
              kind: "removeBot",
              id: row.id,
              body: "{}",
            })
            router.push("/playground/voice-bot")
          }}
        />
      ) : null}
    </>
  )
}
