"use client"
import { BotAttachments, CollectFields } from "./bot-tool-fields"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAction } from "convex/react"
import { BotIcon, SettingsIcon } from "lucide-react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  SectionChrome,
  DetailHeader,
  EmptyState,
  ResourceTable,
  Th,
  RelativeTime,
  TypeToConfirmDialog,
  MoreMenu,
  RadioCards,
  NotFoundState,
} from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TableRow, TableCell } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import { PLAYGROUND_TABS } from "@/lib/dashboard/nav"
import { actionError } from "@/lib/action-error"
import {
  updateVoiceBotLanguage,
  updateVoiceBotVoice,
  voiceBotDefaults,
  type VoiceBotText,
} from "@/lib/voice-bot-defaults"
import {
  newVoiceBot,
  voiceBotFormPayload,
  type VoiceBotResource,
  type VoiceProviderResource,
} from "@/lib/dashboard/voice-bot-form"
import {
  VOICE_STAGE_MODELS,
  GEMINI_LIVE_MODELS,
  type VoiceBotConfig,
  type VoiceProvider,
  type VoiceStage,
} from "@/lib/voice-bots"
import { VoiceChoiceField, ProviderVoiceField, VoiceField } from "./ivr-fields"
import { VoiceRouting } from "./routing"
import { VoiceTester } from "./tester"
import { ProviderKeySelect, ProviderKeyDialog } from "./provider-keys"
import {
  voiceModelLabel,
  VOICE_LANGUAGE_ITEMS,
  VOICE_PROVIDER_LABELS,
  VOICE_TOOL_LABELS,
  voiceLanguageLabel,
  ttsLanguageItems,
  sttLanguageItems,
} from "@/lib/dashboard/voice-options"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  defaultElevenLabsVoice,
  ELEVENLABS_FALLBACK_VOICE_ID,
  type ElevenLabsVoice,
} from "@/lib/elevenlabs-voices"
import { useElevenLabsVoices } from "./elevenlabs-voices"

const engineLabel = (engine: string) =>
  engine === "gemini_live" ? "Gemini Live" : "Sarvam + ElevenLabs"

function notifyLanguageUpdate(
  before: VoiceBotText,
  after: VoiceBotText,
  language: string
) {
  if (
    before.greeting !== after.greeting ||
    before.disclosure !== after.disclosure ||
    before.systemPrompt !== after.systemPrompt
  ) {
    toast.add({
      type: "info",
      title: `Updated for ${voiceLanguageLabel(language)}`,
      timeout: 2500,
    })
  }
}
export function VoiceBotList() {
  const [after, setAfter] = useState<string>(),
    [history, setHistory] = useState<(string | undefined)[]>([]),
    [creating, setCreating] = useState(false),
    [search, setSearch] = useState("")
  const list = useTeamQuery(api.voice.resources.dashboardList, {
    limit: 25,
    after,
  }) as { data: VoiceBotResource[]; has_more: boolean } | undefined
  const keys = useTeamQuery(api.voice.resources.dashboardList, {
    limit: 1,
    providers: true,
  })
  const setup = useTeamQuery(api.calling.playgroundState.setup)
  return (
    <SectionChrome
      title="Playground"
      tabs={PLAYGROUND_TABS}
      actions={
        <Button onClick={() => setCreating(true)}>Create voice bot</Button>
      }
    >
      {!list ? (
        <Skeleton className="h-40 w-full" />
      ) : !list.data.length ? (
        <EmptyState
          icon={BotIcon}
          title="No voice bots"
          description="Build a voice bot and talk to it from your browser."
        >
          <Button onClick={() => setCreating(true)}>Create voice bot</Button>
          {keys && !keys.data.length ? (
            <Link className="text-sm underline" href="/settings/ai-providers">
              Set up AI providers
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor="bot-search">Search voice bots</FieldLabel>
            <Input
              id="bot-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name"
            />
          </Field>
          <ResourceTable
            headers={
              <>
                <Th>Name</Th>
                <Th>Engine</Th>
                <Th className="hidden md:table-cell">Language</Th>
                <Th className="hidden xl:table-cell">Phone numbers</Th>
                <Th className="hidden xl:table-cell">Last test</Th>
                <Th className="hidden md:table-cell">Updated</Th>
              </>
            }
          >
            {list.data
              .filter((b) =>
                b.name.toLowerCase().includes(search.toLowerCase())
              )
              .map((bot) => (
                <TableRow key={bot.id}>
                  <TableCell className="max-w-40 break-words whitespace-normal">
                    <Link
                      className="font-medium hover:underline"
                      href={`/playground/voice-bot/${bot.id}`}
                    >
                      {bot.name}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {engineLabel(bot.engine)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {voiceLanguageLabel(bot.language)}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <span className="flex flex-wrap gap-1">
                      {setup?.numbers
                        .filter((n) => n.routing === `bot:${bot.id}`)
                        .map((n) => (
                          <Badge key={n.id} variant="secondary">
                            {n.label}
                          </Badge>
                        ))}
                    </span>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {bot.lastTestAt ? (
                      <RelativeTime at={bot.lastTestAt} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
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
      <CreateVoiceBotDialog open={creating} onOpenChange={setCreating} />
    </SectionChrome>
  )
}
export function CreateVoiceBotDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <CreateBot close={() => onOpenChange(false)} /> : null}
    </Dialog>
  )
}
function CreateBot({ close }: { close: () => void }) {
  const [name, setName] = useState(""),
    [engine, setEngine] = useState<VoiceBotConfig["engine"]>("gemini_live"),
    [language, setLanguage] = useState("en"),
    [instructions, setInstructions] = useState(() => voiceBotDefaults("en")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [adding, setAdding] = useState(false)
  const keys = useTeamQuery(api.voice.resources.dashboardList, {
    limit: 100,
    providers: true,
  }) as { data: VoiceProviderResource[] } | undefined
  const { activeTeamId } = useWorkspace(),
    router = useRouter(),
    write = useAction(api.voice.resources.dashboardWrite)
  const provider = engine === "gemini_live" ? "gemini" : "sarvam"
  const elevenKey = keys?.data.find((key) => key.provider === "elevenlabs")
  const catalog = useElevenLabsVoices(
    elevenKey?.id,
    engine === "cascade" && !!elevenKey
  )
  const elevenReady =
    engine === "cascade" &&
    ttsLanguageItems("elevenlabs", "eleven_multilingual_v2").some(
      (item) => item.value === language.split("-")[0]
    )
  const patchInstructions = (patch: Partial<VoiceBotText>) =>
    setInstructions((current) => ({ ...current, ...patch }))
  const changeLanguage = (language: string) => {
    const next = updateVoiceBotLanguage(
      instructions,
      language,
      engine === "gemini_live" ? "female" : "male"
    )
    setLanguage(language)
    setInstructions(next)
    notifyLanguageUpdate(instructions, next, language)
  }
  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          const key = keys?.data.find((k) => k.provider === provider)
          if (!key) {
            setAdding(true)
            return
          }
          setBusy(true)
          setError("")
          try {
            const draft = newVoiceBot(engine, language)
            // The dialog offers Sarvam languages; the default ElevenLabs model
            // supports only some of them. Keep the Sarvam voice for the others.
            const eleven = ttsLanguageItems(
              "elevenlabs",
              "eleven_multilingual_v2"
            ).some((item) => item.value === language.split("-")[0])
              ? keys?.data.find((k) => k.provider === "elevenlabs")
              : undefined
            const live =
              eleven && catalog.loaded && catalog.hasKey
                ? catalog.voices
                : undefined
            const config = {
              ...draft,
              name,
              ...instructions,
              language,
              credentialId: key.id,
              ...(engine === "cascade"
                ? {
                    stt: { ...draft.stt!, credentialId: key.id },
                    llm: { ...draft.llm!, credentialId: key.id },
                    tts: eleven
                      ? {
                          provider: "elevenlabs" as const,
                          model: "eleven_multilingual_v2",
                          voice: defaultElevenLabsVoice(live ?? []),
                          credentialId: eleven.id,
                        }
                      : { ...draft.tts!, credentialId: key.id },
                  }
                : {}),
            }
            const result = await write({
              organizationId: activeTeamId!,
              kind: "bot",
              body: JSON.stringify(
                voiceBotFormPayload(updateVoiceBotVoice(config, live))
              ),
            })
            close()
            router.push(`/playground/voice-bot/${result.id}`)
          } catch (e) {
            setError(actionError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Create voice bot</DialogTitle>
          <DialogDescription>
            Choose how your bot listens and speaks.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-5">
          <VoiceField label="Name" value={name} onChange={setName} />
          <Field>
            <FieldLabel>Engine</FieldLabel>
            <RadioCards
              aria-label="Engine"
              value={engine}
              onChange={(value) => {
                setEngine(value)
                changeLanguage(value === "cascade" ? "en-IN" : "en")
              }}
              options={[
                {
                  value: "gemini_live",
                  label: "Gemini Live",
                  description: "Speech to speech, lowest latency.",
                },
                {
                  value: "cascade",
                  label: "Cascade",
                  description:
                    "Sarvam speech-to-text → AI → ElevenLabs or Sarvam voice. Best for Indian languages.",
                },
              ]}
            />
          </Field>
          <VoiceChoiceField
            label="Language"
            value={language}
            items={
              engine === "gemini_live"
                ? VOICE_LANGUAGE_ITEMS
                : ttsLanguageItems("sarvam", "bulbul:v3")
            }
            onChange={changeLanguage}
          />
          <Field>
            <FieldLabel>System prompt</FieldLabel>
            <Textarea
              aria-label="System prompt"
              value={instructions.systemPrompt}
              onChange={(e) =>
                patchInstructions({ systemPrompt: e.target.value })
              }
            />
          </Field>
          <VoiceField
            label="Greeting"
            value={instructions.greeting}
            onChange={(greeting) => patchInstructions({ greeting })}
          />
          <VoiceField
            label="AI disclosure"
            value={instructions.disclosure}
            onChange={(disclosure) => patchInstructions({ disclosure })}
          />
          {keys && !keys.data.some((k) => k.provider === provider) ? (
            <p className="text-sm text-muted-foreground">
              Add a {VOICE_PROVIDER_LABELS[provider]} key to create this bot.
            </p>
          ) : null}
          {error || (elevenReady ? catalog.error : "") ? (
            <p role="alert" className="text-destructive">
              {error || catalog.error}
            </p>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
      <ProviderKeyDialog
        open={adding}
        onOpenChange={setAdding}
        provider={provider}
      />
    </DialogContent>
  )
}
export function VoiceBotEditor({ id }: { id?: string }) {
  const row = useTeamQuery(
    api.voice.resources.dashboardGet,
    { id: id ?? "" },
    { enabled: !!id }
  ) as VoiceBotResource | null | undefined
  if (!id) return <VoiceBotList />
  if (row === null)
    return (
      <NotFoundState
        icon={BotIcon}
        noun="voice bot"
        backHref="/playground/voice-bot"
      />
    )
  if (!row) return <Skeleton className="h-60 w-full" />
  return <BotForm key={id} row={row} />
}
function RailSection({
  title,
  children,
  open = true,
}: {
  title: string
  children: React.ReactNode
  open?: boolean
}) {
  return (
    <details open={open} className="border-b border-border">
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
        {title}
      </summary>
      <div className="flex flex-col gap-4 px-5 pb-5">{children}</div>
    </details>
  )
}
function StageFields({
  name,
  stage,
  onChange,
}: {
  name: "stt" | "llm" | "tts"
  stage: VoiceStage
  onChange: (stage: VoiceStage) => void
}) {
  const models = VOICE_STAGE_MODELS[name] as Partial<
    Record<VoiceProvider, readonly string[]>
  >
  const label = {
    stt: "Speech recognition",
    llm: "Language model",
    tts: "Speech voice",
  }[name]
  return (
    <div className="flex flex-col gap-3">
      <VoiceChoiceField
        label={`${label} provider`}
        value={stage.provider}
        items={Object.keys(models).map((value) => ({
          value,
          label: VOICE_PROVIDER_LABELS[value as VoiceProvider],
        }))}
        onChange={(provider) =>
          onChange({
            ...stage,
            provider: provider as VoiceProvider,
            model: models[provider as VoiceProvider]![0],
            credentialId: "",
            ...(name === "stt" ? { language: "auto" } : {}),
            ...(name === "tts"
              ? {
                  voice:
                    provider === "sarvam"
                      ? "shubh"
                      : ELEVENLABS_FALLBACK_VOICE_ID,
                }
              : {}),
          })
        }
      />
      <VoiceChoiceField
        label={`${label} model`}
        value={stage.model}
        items={(models[stage.provider] ?? []).map((value) => ({
          value,
          label: voiceModelLabel(value),
        }))}
        onChange={(model) => onChange({ ...stage, model })}
      />
      <ProviderKeySelect
        label={`${label} key`}
        provider={stage.provider}
        value={stage.credentialId}
        onChange={(credentialId) => onChange({ ...stage, credentialId })}
      />
      {name === "stt" ? (
        <VoiceChoiceField
          label="Recognition language"
          value={stage.language ?? "auto"}
          items={sttLanguageItems(stage.provider)}
          onChange={(language) => onChange({ ...stage, language })}
        />
      ) : null}
    </div>
  )
}
function BotForm({ row }: { row: VoiceBotResource }) {
  const router = useRouter(),
    { activeTeamId } = useWorkspace(),
    mobile = useIsMobile()
  const [draft, setDraft] = useState<VoiceBotConfig>(() =>
      voiceBotFormPayload(row)
    ),
    [saved, setSaved] = useState(() => JSON.stringify(voiceBotFormPayload(row)))
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [voiceError, setVoiceError] = useState(""),
    [adoptVoice, setAdoptVoice] = useState(false),
    [deleting, setDeleting] = useState(false),
    [settings, setSettings] = useState(false),
    [expand, setExpand] = useState(false),
    [rename, setRename] = useState(false)
  const liveVoices = useRef<ElevenLabsVoice[] | undefined>(undefined)
  const ivrs = useTeamQuery(api.ivr.definitions.dashboardList, { limit: 100 })
  const write = useAction(api.voice.resources.dashboardWrite)
  const gendered = (next: VoiceBotConfig) =>
    next.engine === "cascade" && next.tts?.provider === "elevenlabs"
      ? liveVoices.current
      : undefined
  const patch = (p: Partial<VoiceBotConfig>) =>
    setDraft((d) => {
      const next = { ...d, ...p }
      return p.voice !== undefined || p.tts !== undefined
        ? updateVoiceBotVoice(next, gendered(next))
        : next
    })
  useEffect(() => {
    document.title = `${row.name} · opensend.cc`
  }, [row.name])
  async function save() {
    setBusy(true)
    setError("")
    try {
      const body = JSON.stringify(voiceBotFormPayload(draft))
      await write({
        organizationId: activeTeamId!,
        kind: "bot",
        id: row.id,
        body,
      })
      setSaved(body)
      toast.add({ type: "success", title: "Voice bot saved" })
    } catch (e) {
      setError(actionError(e))
    } finally {
      setBusy(false)
    }
  }
  const rail = (
    <>
      <RailSection title="Instructions">
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel>System prompt</FieldLabel>
            <Button size="sm" variant="ghost" onClick={() => setExpand(true)}>
              Expand
            </Button>
          </div>
          <Textarea
            aria-label="System prompt"
            className="[field-sizing:content] min-h-40"
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
      </RailSection>
      <RailSection title="Voice & language">
        <ProviderVoiceField
          provider={
            draft.engine === "gemini_live" ? "gemini" : draft.tts!.provider
          }
          credentialId={
            draft.engine === "gemini_live" ? undefined : draft.tts!.credentialId
          }
          quietError
          adoptDefault={
            adoptVoice &&
            draft.engine === "cascade" &&
            draft.tts?.provider === "elevenlabs"
          }
          onAdopted={() => setAdoptVoice(false)}
          onError={setVoiceError}
          onVoices={(voices) => {
            liveVoices.current = voices
          }}
          label="Voice"
          value={
            draft.engine === "gemini_live"
              ? draft.voice
              : (draft.tts!.voice ?? "")
          }
          onChange={(voice) => {
            setAdoptVoice(false)
            patch(
              draft.engine === "gemini_live"
                ? { voice }
                : { tts: { ...draft.tts!, voice } }
            )
          }}
        />
        <VoiceChoiceField
          label="Language"
          value={draft.language}
          items={
            draft.engine === "gemini_live"
              ? VOICE_LANGUAGE_ITEMS
              : ttsLanguageItems(
                  draft.tts!.provider as "sarvam" | "elevenlabs",
                  draft.tts!.model
                )
          }
          onChange={(language) => {
            const next = updateVoiceBotVoice(
              { ...draft, language },
              gendered({ ...draft, language })
            )
            setDraft(next)
            notifyLanguageUpdate(draft, next, language)
          }}
        />
      </RailSection>
      <RailSection title="Models">
        {draft.engine === "gemini_live" ? (
          <>
            <VoiceChoiceField
              label="Gemini Live model"
              value={draft.model}
              items={GEMINI_LIVE_MODELS.map((value) => ({
                value,
                label: voiceModelLabel(value),
              }))}
              onChange={(model) => patch({ model })}
            />
            <ProviderKeySelect
              label="Gemini key"
              provider="gemini"
              value={draft.credentialId}
              onChange={(credentialId) => patch({ credentialId })}
            />
          </>
        ) : (
          (["stt", "llm", "tts"] as const).map((name) => (
            <StageFields
              key={name}
              name={name}
              stage={draft[name]!}
              onChange={(stage) => {
                if (
                  name === "tts" &&
                  stage.provider === "elevenlabs" &&
                  draft.tts?.provider !== "elevenlabs"
                )
                  setAdoptVoice(true)
                else if (name === "tts" && stage.provider !== "elevenlabs")
                  setAdoptVoice(false)
                patch({
                  [name]: stage,
                  ...(name === "stt"
                    ? {
                        provider: stage.provider,
                        credentialId: stage.credentialId,
                      }
                    : {}),
                })
              }}
            />
          ))
        )}
      </RailSection>
      <RailSection title="Knowledge">
        <BotAttachments kind="knowledge" config={draft} onChange={patch} />
      </RailSection>
      <RailSection title="Collect data">
        <CollectFields
          fields={draft.collect ?? []}
          onChange={(collect) => patch({ collect })}
        />
      </RailSection>
      <RailSection title="Webhook tools">
        <BotAttachments kind="tools" config={draft} onChange={patch} />
      </RailSection>
      <RailSection title="Tools">
        <Field>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Look up the caller when the call starts</FieldLabel>
            <Switch
              aria-label="Look up the caller when the call starts"
              checked={draft.callerContext !== false}
              onCheckedChange={(callerContext) => patch({ callerContext })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Adds this caller’s CRM record to the instructions before the first
            reply.
          </p>
        </Field>
        {Object.entries(VOICE_TOOL_LABELS).map(([name, label]) => (
          <Field key={name}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>{label}</FieldLabel>
              <Switch
                aria-label={`Enable ${label}`}
                checked={draft.tools.includes(
                  name as (typeof draft.tools)[number]
                )}
                onCheckedChange={(enabled) =>
                  patch({
                    tools: enabled
                      ? [...draft.tools, name as (typeof draft.tools)[number]]
                      : draft.tools.filter((t) => t !== name),
                    ...(name === "transfer_to_agent"
                      ? { handoff: { ...draft.handoff, agents: enabled } }
                      : {}),
                  })
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {
                {
                  lookup_contact:
                    "Find the caller’s contact and recent messages.",
                  create_note: "Save a note about this call.",
                  send_whatsapp_message: "Send a message to the caller.",
                  transfer_to_agent: "Connect to an available team member.",
                  transfer_to_ivr: "Continue in a phone menu.",
                  end_call: "Say goodbye and end the call.",
                }[name]
              }
            </p>
          </Field>
        ))}
        {draft.tools.includes("transfer_to_ivr") ? (
          <VoiceChoiceField
            label="Transfer IVR"
            value={draft.handoff.ivrId ?? ""}
            items={(ivrs?.data ?? []).map((v) => ({
              value: v.id,
              label: v.name,
            }))}
            onChange={(ivrId) =>
              patch({ handoff: { ...draft.handoff, ivrId } })
            }
          />
        ) : null}
      </RailSection>
      <RailSection title="Phone numbers">
        <VoiceRouting kind="bot" id={row.id} />
      </RailSection>
      <RailSection title="Advanced" open={false}>
        <VoiceField
          label="Max call length (seconds)"
          type="number"
          value={draft.maxDurationSeconds}
          onChange={(v) => patch({ maxDurationSeconds: Number(v) })}
        />
        <VoiceField
          label="Silence timeout (seconds)"
          type="number"
          value={draft.silenceTimeoutSeconds}
          onChange={(v) => patch({ silenceTimeoutSeconds: Number(v) })}
        />
        <VoiceField
          label="Monthly minutes"
          type="number"
          value={draft.monthlyMinuteBudget ?? ""}
          onChange={(v) =>
            patch({ monthlyMinuteBudget: v ? Number(v) : undefined })
          }
        />
        <VoiceField
          label="Concurrent calls"
          type="number"
          value={draft.maxConcurrentCalls ?? ""}
          onChange={(v) =>
            patch({ maxConcurrentCalls: v ? Number(v) : undefined })
          }
        />
        <Field orientation="horizontal">
          <FieldLabel>Record calls</FieldLabel>
          <Switch
            aria-label="Record calls"
            checked={draft.recording}
            onCheckedChange={(recording) => patch({ recording })}
          />
        </Field>
      </RailSection>
    </>
  )
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DetailHeader
        backHref="/playground/voice-bot"
        backLabel="Voice bots"
        title={row.name}
        icon={BotIcon}
        badge={<Badge variant="secondary">{engineLabel(row.engine)}</Badge>}
        actions={
          <>
            {JSON.stringify(draft) !== saved ? (
              <span className="text-xs text-muted-foreground">
                Changes not saved
              </span>
            ) : null}
            {mobile ? (
              <Button variant="outline" onClick={() => setSettings(true)}>
                <SettingsIcon />
                Settings
              </Button>
            ) : null}
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <MoreMenu>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setRename(true)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    try {
                      const result = await write({
                        organizationId: activeTeamId!,
                        kind: "bot",
                        body: JSON.stringify(
                          voiceBotFormPayload({
                            ...draft,
                            name: `${draft.name} copy`,
                          })
                        ),
                      })
                      router.push(`/playground/voice-bot/${result.id}`)
                    } catch (e) {
                      setError(actionError(e))
                    }
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void navigator.clipboard.writeText(row.id)}
                >
                  Copy ID
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDeleting(true)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </MoreMenu>
          </>
        }
      />
      {error ||
      (draft.engine === "cascade" && draft.tts?.provider === "elevenlabs"
        ? voiceError
        : "") ? (
        <p role="alert" className="text-destructive">
          {error || voiceError}
        </p>
      ) : null}
      <div className="grid min-w-0 overflow-hidden rounded-xl border border-border lg:grid-cols-[minmax(0,1fr)_380px]">
        <VoiceTester kind="bot" id={row.id} name={row.name} />
        {!mobile ? (
          <aside
            aria-label="Bot settings"
            className="max-h-[78vh] overflow-y-auto border-l border-border"
          >
            {rail}
          </aside>
        ) : null}
      </div>
      <Sheet open={settings} onOpenChange={setSettings}>
        <SheetContent className="overflow-y-auto data-[side=right]:w-full">
          <SheetHeader>
            <SheetTitle>Settings</SheetTitle>
          </SheetHeader>
          {mobile ? rail : null}
        </SheetContent>
      </Sheet>
      <Dialog open={expand} onOpenChange={setExpand}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>System prompt</DialogTitle>
            <DialogDescription>
              Tell your bot how to help callers.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Expanded system prompt"
            className="[field-sizing:content] min-h-[50vh]"
            value={draft.systemPrompt}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
          />
          <DialogFooter>
            <Button onClick={() => setExpand(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={rename} onOpenChange={setRename}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename voice bot</DialogTitle>
          </DialogHeader>
          <VoiceField
            label="Name"
            value={draft.name}
            onChange={(name) => patch({ name })}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                patch({ name: row.name })
                setRename(false)
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => setRename(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TypeToConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete voice bot"
        description="Remove phone routing before deleting this bot."
        phrase={row.name}
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
    </div>
  )
}
