"use client"
import { useState } from "react"
import { useAction } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import {
  DetailSection,
  ResourceTable,
  Th,
  OptionSelect,
  TypeToConfirmDialog,
} from "@/components/dashboard/primitives"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { actionError } from "@/lib/action-error"
import type { VoiceProviderResource } from "@/lib/dashboard/voice-bot-form"
export function ProviderKeys() {
  const { activeTeamId } = useWorkspace()
  const keys: { data: VoiceProviderResource[] } | undefined = useTeamQuery(
    api.voice.resources.dashboardList,
    { limit: 100, providers: true }
  ) as { data: VoiceProviderResource[] } | undefined
  const write = useAction(api.voice.resources.dashboardWrite)
  const [provider, setProvider] = useState("gemini"),
    [label, setLabel] = useState(""),
    [key, setKey] = useState("")
  const [pending, setPending] = useState(false),
    [error, setError] = useState("")
  const [deleting, setDeleting] = useState<VoiceProviderResource | null>(null)
  return (
    <DetailSection title="Provider keys">
      <p className="text-sm text-muted-foreground">
        Bring your own Gemini, Sarvam or ElevenLabs key. Keys are encrypted and
        write-only; reads show the last four characters. Bots and IVR prompts
        share these team credentials.
      </p>
      <form
        className="grid items-end gap-3 sm:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setPending(true)
          setError("")
          try {
            await write({
              organizationId: activeTeamId!,
              kind: "provider",
              body: JSON.stringify({ provider, label, key }),
            })
            setKey("")
            setLabel("")
          } catch (e) {
            setError(actionError(e))
          } finally {
            setPending(false)
          }
        }}
      >
        <Field>
          <FieldLabel>Provider</FieldLabel>
          <OptionSelect
            aria-label="Key provider"
            value={provider}
            onChange={setProvider}
            items={[
              { value: "gemini", label: "Gemini" },
              { value: "sarvam", label: "Sarvam" },
              { value: "elevenlabs", label: "ElevenLabs" },
            ]}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="provider-label">Label</FieldLabel>
          <Input
            id="provider-label"
            value={label}
            maxLength={100}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="provider-key">API key</FieldLabel>
          <Input
            id="provider-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          disabled={pending || !label.trim() || !key.trim()}
        >
          {pending ? "Adding…" : "Add provider key"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {!keys ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ResourceTable
          headers={
            <>
              <Th>Provider</Th>
              <Th>Label</Th>
              <Th>Key</Th>
              <Th />
            </>
          }
        >
          {keys.data.length ? (
            keys.data.map((k) => (
              <TableRow key={k.id}>
                <TableCell>{k.provider}</TableCell>
                <TableCell>{k.label}</TableCell>
                <TableCell>••••{k.lastFour}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    onClick={() => setDeleting(k)}
                    aria-label={`Delete key ${k.label}`}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={4}>No provider keys</TableCell>
            </TableRow>
          )}
        </ResourceTable>
      )}
      {deleting ? (
        <TypeToConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
          title="Delete provider key"
          phrase={deleting.label}
          description="Remove bots and IVR prompt voices using this credential before deleting it."
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
    </DetailSection>
  )
}
