"use client"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { DetailSection, OptionSelect } from "@/components/dashboard/primitives"
import type { VoiceProviderResource } from "@/lib/dashboard/voice-bot-form"
import { SARVAM_PROMPT_VOICES, type IvrPromptVoice } from "@/lib/ivr-renderers"
import { VoiceField } from "./ivr-fields"
export function IvrPromptVoiceFields({
  value,
  onChange,
}: {
  value: IvrPromptVoice | undefined
  onChange: (voice: IvrPromptVoice | undefined) => void
}) {
  const keys = useTeamQuery(api.voice.resources.dashboardList, {
    limit: 100,
    providers: true,
  }) as { data: VoiceProviderResource[] } | undefined
  return (
    <DetailSection title="Prompt voice">
      <p className="text-sm text-muted-foreground">
        Choose a team provider key to render typed prompts on save. Uploaded
        audio works independently. Legacy text without a provider stays pending.
      </p>
      <OptionSelect
        aria-label="Prompt provider"
        value={value?.provider ?? "none"}
        items={[
          { value: "none", label: "No TTS provider" },
          { value: "sarvam", label: "Sarvam Bulbul v3" },
          { value: "elevenlabs", label: "ElevenLabs" },
        ]}
        onChange={(provider) =>
          onChange(
            provider === "none"
              ? undefined
              : {
                  provider: provider as "sarvam" | "elevenlabs",
                  credentialId: "",
                  voice: provider === "sarvam" ? "shubh" : "",
                  language: provider === "sarvam" ? "en-IN" : "en",
                }
          )
        }
      />
      {value ? (
        <>
          <OptionSelect
            aria-label="Prompt provider key"
            placeholder="Choose a team key"
            value={value.credentialId}
            items={(keys?.data ?? [])
              .filter((k) => k.provider === value.provider)
              .map((k) => ({
                value: k.id,
                label: `${k.label} · ••••${k.lastFour}`,
              }))}
            onChange={(credentialId) => onChange({ ...value, credentialId })}
          />
          {value.provider === "sarvam" ? (
            <OptionSelect
              aria-label="Prompt voice"
              value={value.voice}
              items={SARVAM_PROMPT_VOICES.map((voice) => ({
                value: voice,
                label: voice,
              }))}
              onChange={(voice) => onChange({ ...value, voice })}
            />
          ) : (
            <VoiceField
              label="ElevenLabs voice ID"
              value={value.voice}
              onChange={(voice) => onChange({ ...value, voice })}
            />
          )}
          <VoiceField
            label="Prompt language"
            value={value.language}
            onChange={(language) => onChange({ ...value, language })}
          />
        </>
      ) : null}
    </DetailSection>
  )
}
