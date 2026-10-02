"use client"
import { useState } from "react"
import {
  KeyRoundIcon,
  SparklesIcon,
  LanguagesIcon,
  AudioLinesIcon,
} from "lucide-react"
import { useAction } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  DetailSection,
  ResourceTable,
  Th,
  OptionSelect,
  TypeToConfirmDialog,
  MoreMenu,
  RelativeTime,
  EmptyState,
} from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenuItem,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { actionError } from "@/lib/action-error"
import type { VoiceProviderResource } from "@/lib/dashboard/voice-bot-form"
import { VOICE_PROVIDER_LABELS } from "@/lib/dashboard/voice-options"
import type { VoiceProvider } from "@/lib/voice-bots"

const descriptions = {
  gemini: "Live conversations and language models.",
  sarvam: "Speech recognition and voices for Indian languages.",
  elevenlabs: "Natural voices and speech recognition.",
}
export function ProviderKeyDialog({
  open,
  onOpenChange,
  provider = "gemini",
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider?: VoiceProvider
  onAdded?: (id: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ProviderKeyForm
          provider={provider}
          close={() => onOpenChange(false)}
          onAdded={onAdded}
        />
      ) : null}
    </Dialog>
  )
}
function ProviderKeyForm({
  provider: initial,
  close,
  onAdded,
}: {
  provider: VoiceProvider
  close: () => void
  onAdded?: (id: string) => void
}) {
  const { activeTeamId } = useWorkspace()
  const write = useAction(api.voice.resources.dashboardWrite)
  const [provider, setProvider] = useState<VoiceProvider>(initial),
    [label, setLabel] = useState(""),
    [key, setKey] = useState("")
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("")
  return (
    <DialogContent>
      <form
        autoComplete="off"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError("")
          try {
            const result = await write({
              organizationId: activeTeamId!,
              kind: "provider",
              body: JSON.stringify({ provider, label, key }),
            })
            setKey("")
            onAdded?.(result.id)
            close()
          } catch (e) {
            setError(actionError(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Add provider key</DialogTitle>
          <DialogDescription>
            Keys are encrypted. Only the last four characters are shown.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-5">
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <OptionSelect
              aria-label="Provider"
              value={provider}
              onChange={(v) => setProvider(v as VoiceProvider)}
              items={Object.entries(VOICE_PROVIDER_LABELS).map(
                ([value, label]) => ({
                  value,
                  label,
                  description: descriptions[value as VoiceProvider],
                })
              )}
            />
            <p className="text-sm text-muted-foreground">
              {descriptions[provider]}
            </p>
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-label">Label</FieldLabel>
            <Input
              id="provider-label"
              autoComplete="off"
              value={label}
              maxLength={100}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="provider-key">API key</FieldLabel>
            <Input
              id="provider-key"
              credential
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </Field>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !label.trim() || !key.trim()}>
            {busy ? "Adding…" : "Add"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
export function ProviderKeySelect({
  label,
  provider,
  value,
  onChange,
}: {
  label: string
  provider: VoiceProvider
  value: string
  onChange: (id: string) => void
}) {
  const keys = useTeamQuery(api.voice.resources.dashboardList, {
    limit: 100,
    providers: true,
  }) as { data: VoiceProviderResource[] } | undefined
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Field>
        <FieldLabel>{label}</FieldLabel>
        <OptionSelect
          aria-label={label}
          placeholder="Choose a provider key"
          value={value}
          items={[
            ...(keys?.data ?? [])
              .filter((k) => k.provider === provider)
              .map((k) => ({
                value: k.id,
                label: `${k.label} · ••••${k.lastFour}`,
              })),
            { value: "add", label: "Add provider key…" },
          ]}
          onChange={(v) => (v === "add" ? setAdding(true) : onChange(v))}
        />
      </Field>
      <ProviderKeyDialog
        open={adding}
        onOpenChange={setAdding}
        provider={provider}
        onAdded={onChange}
      />
    </>
  )
}
export function ProviderKeys() {
  const { activeTeamId } = useWorkspace()
  const keys = useTeamQuery(api.voice.resources.dashboardList, {
    limit: 100,
    providers: true,
  }) as { data: VoiceProviderResource[] } | undefined
  const write = useAction(api.voice.resources.dashboardWrite)
  const [adding, setAdding] = useState(false),
    [deleting, setDeleting] = useState<VoiceProviderResource | null>(null)
  return (
    <>
      <DetailSection
        title="AI providers"
        actions={
          <Button onClick={() => setAdding(true)}>Add provider key</Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          Connect the providers used by your voice bots and IVR prompts.
        </p>
        {!keys ? (
          <Skeleton className="h-24 w-full" />
        ) : !keys.data.length ? (
          <EmptyState
            icon={KeyRoundIcon}
            title="No provider keys"
            description="Add a key to start using AI voices and conversations."
          />
        ) : (
          <ResourceTable
            headers={
              <>
                <Th>Provider</Th>
                <Th>Label</Th>
                <Th>Key</Th>
                <Th className="hidden md:table-cell">Added</Th>
                <Th />
              </>
            }
          >
            {keys.data.map((k) => (
              <TableRow key={k.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <ProviderIcon provider={k.provider} />
                    {VOICE_PROVIDER_LABELS[k.provider]}
                  </span>
                </TableCell>
                <TableCell className="max-w-32 break-words whitespace-normal">
                  {k.label}
                </TableCell>
                <TableCell>••••{k.lastFour}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <RelativeTime at={k.createdAt} />
                </TableCell>
                <TableCell>
                  <MoreMenu>
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => setDeleting(k)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </MoreMenu>
                </TableCell>
              </TableRow>
            ))}
          </ResourceTable>
        )}
      </DetailSection>
      <ProviderKeyDialog open={adding} onOpenChange={setAdding} />
      {deleting ? (
        <TypeToConfirmDialog
          open
          onOpenChange={(v) => {
            if (!v) setDeleting(null)
          }}
          title="Delete provider key"
          phrase={deleting.label}
          description="Remove bots and IVR voices using this key first."
          confirmLabel="Delete provider key"
          onConfirm={() =>
            write({
              organizationId: activeTeamId!,
              kind: "removeProvider",
              id: deleting.id,
              body: "{}",
            })
          }
        />
      ) : null}
    </>
  )
}

function ProviderIcon({ provider }: { provider: VoiceProvider }) {
  const Icon = {
    gemini: SparklesIcon,
    sarvam: LanguagesIcon,
    elevenlabs: AudioLinesIcon,
  }[provider]
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}
