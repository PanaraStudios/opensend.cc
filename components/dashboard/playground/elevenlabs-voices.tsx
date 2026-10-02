"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useAction } from "convex/react"
import { useTeamQuery, useWorkspace } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/dashboard/primitives"
import { actionError } from "@/lib/action-error"
import {
  defaultElevenLabsVoice,
  elevenLabsVoiceDetail,
  voiceCacheFresh,
  type ElevenLabsVoice,
} from "@/lib/elevenlabs-voices"

const noVoices: ElevenLabsVoice[] = []
type Catalog = {
  hasKey: boolean
  voices: ElevenLabsVoice[]
  credentialId?: Id<"voiceProviders">
  refreshedAt?: number
  error?: string
}

export function useElevenLabsVoices(credentialId?: string, enabled = true) {
  const { activeTeamId } = useWorkspace()
  const data = useTeamQuery(
    api.voice.elevenlabsState.dashboardVoices,
    credentialId ? { credentialId: credentialId as Id<"voiceProviders"> } : {},
    { enabled }
  ) as Catalog | undefined
  const refreshAction = useAction(api.voice.elevenlabs.dashboardRefresh)
  const [refreshing, setRefreshing] = useState(false)
  const [localError, setLocalError] = useState("")
  const attempted = useRef<string | null>(null)
  const ticket = useRef(0)
  const hasKey = data?.hasKey === true
  const refreshedAt = data?.refreshedAt
  const serverCredential = data?.credentialId
  const target = (credentialId || serverCredential) as
    Id<"voiceProviders"> | undefined
  useEffect(() => {
    if (!enabled || !hasKey || !activeTeamId) return
    if (voiceCacheFresh(refreshedAt, Date.now())) return
    const marker = target ?? "newest"
    if (attempted.current === marker) return
    attempted.current = marker
    const request = ++ticket.current
    setRefreshing(true)
    void refreshAction({
      organizationId: activeTeamId,
      ...(target ? { credentialId: target } : {}),
      force: false,
    })
      .catch((error: unknown) => {
        if (ticket.current === request) setLocalError(actionError(error))
      })
      .finally(() => {
        if (ticket.current === request) setRefreshing(false)
      })
  }, [enabled, hasKey, refreshedAt, target, activeTeamId, refreshAction])
  async function refresh() {
    if (!activeTeamId || !hasKey) return
    const request = ++ticket.current
    setRefreshing(true)
    setLocalError("")
    try {
      await refreshAction({
        organizationId: activeTeamId,
        ...(target ? { credentialId: target } : {}),
        force: true,
      })
    } catch (error) {
      if (ticket.current === request) setLocalError(actionError(error))
    } finally {
      if (ticket.current === request) setRefreshing(false)
    }
  }
  return {
    hasKey,
    loaded: !enabled || data !== undefined,
    voices: data?.voices ?? noVoices,
    error: data?.error || localError,
    refreshing,
    refresh,
  }
}

export function ElevenLabsVoiceField({
  label,
  value,
  onChange,
  credentialId,
  inherit = false,
  quietError = false,
  adoptDefault = false,
  onAdopted,
  onError,
  onVoices,
}: {
  label: string
  value: string
  onChange: (voice: string) => void
  credentialId?: string
  inherit?: boolean
  quietError?: boolean
  adoptDefault?: boolean
  onAdopted?: () => void
  onError?: (error: string) => void
  onVoices?: (voices: ElevenLabsVoice[] | undefined) => void
}) {
  const catalog = useElevenLabsVoices(credentialId || undefined, true)
  const [query, setQuery] = useState("")
  const adopted = useRef(false)
  useEffect(() => {
    onVoices?.(catalog.loaded && catalog.hasKey ? catalog.voices : undefined)
  }, [catalog.loaded, catalog.hasKey, catalog.voices, onVoices])
  useEffect(() => {
    onError?.(catalog.error)
  }, [catalog.error, onError])
  useEffect(() => {
    if (!adoptDefault) {
      adopted.current = false
      return
    }
    if (adopted.current || !catalog.loaded) return
    adopted.current = true
    onAdopted?.()
    const next = defaultElevenLabsVoice(catalog.voices)
    if (next !== value) onChange(next)
  }, [adoptDefault, catalog.loaded, catalog.voices, onAdopted, onChange, value])
  const needle = query.trim().toLowerCase()
  const items = [
    ...(inherit ? [{ value: "", label: "Use prompt voice" }] : []),
    ...catalog.voices
      .filter((voice) => {
        if (!needle) return true
        return `${voice.label} ${elevenLabsVoiceDetail(voice)}`
          .toLowerCase()
          .includes(needle)
      })
      .map((voice) => ({
        value: voice.value,
        label: voice.label,
        description: elevenLabsVoiceDetail(voice),
      })),
  ]
  const known = catalog.voices.find((voice) => voice.value === value)
  const selectedItem = !value
    ? inherit
      ? { value: "", label: "Use prompt voice" }
      : undefined
    : !catalog.loaded
      ? { value, label: "Loading voices…" }
      : known
        ? {
            value: known.value,
            label: known.label,
            description: elevenLabsVoiceDetail(known),
          }
        : { value, label: `Custom voice ${value}` }
  const loading =
    !catalog.loaded ||
    (catalog.hasKey && catalog.refreshing && !catalog.voices.length)
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        {catalog.hasKey ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={catalog.refreshing}
            onClick={() => void catalog.refresh()}
          >
            {catalog.refreshing ? "Refreshing…" : "Refresh voices"}
          </Button>
        ) : null}
      </div>
      {catalog.loaded && !catalog.hasKey ? (
        <p className="text-sm text-muted-foreground">
          Add an ElevenLabs key in{" "}
          <Link className="underline" href="/settings/ai-providers">
            Settings › AI providers
          </Link>{" "}
          to list voices.
        </p>
      ) : null}
      {!quietError && catalog.error ? (
        <p role="alert" className="text-sm text-destructive">
          {catalog.error}
        </p>
      ) : null}
      {catalog.loaded &&
      catalog.hasKey &&
      !catalog.refreshing &&
      catalog.voices.length === 0 &&
      !catalog.error ? (
        <p className="text-sm text-muted-foreground">
          No voices were returned for this key.
        </p>
      ) : null}
      <OptionSelect
        aria-label={label}
        value={value}
        items={items}
        selectedItem={selectedItem}
        placeholder={loading ? "Loading voices…" : "Choose a voice"}
        emptyLabel={
          needle ? "No results found." : "No voices were returned for this key."
        }
        disabled={catalog.loaded && !catalog.hasKey}
        search={{ onChange: setQuery, placeholder: "Search voices" }}
        onChange={onChange}
      />
    </Field>
  )
}
