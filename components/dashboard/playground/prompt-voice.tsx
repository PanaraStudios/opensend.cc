"use client"
import { useTeamQuery } from "@/components/auth/workspace"
import { api } from "@/convex/_generated/api"
import { DetailSection, OptionSelect } from "@/components/dashboard/primitives"
import type { VoiceProviderResource } from "@/lib/dashboard/voice-bot-form"
import { type IvrPromptVoice } from "@/lib/ivr-renderers"
import { VoiceChoiceField, ProviderVoiceField } from "./ivr-fields"
import {
  SARVAM_PROMPT_LANGUAGE_ITEMS,
  ttsLanguageItems,
} from "@/lib/dashboard/voice-options"
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
        audio works independently. Typed prompts need a provider and voice
        before audio can be rendered.
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
          <ProviderVoiceField
            label="Prompt voice"
            provider={value.provider}
            value={value.voice}
            onChange={(voice) => onChange({ ...value, voice })}
          />
          <VoiceChoiceField
            items={
              value.provider === "sarvam"
                ? SARVAM_PROMPT_LANGUAGE_ITEMS
                : ttsLanguageItems("elevenlabs", "eleven_multilingual_v2")
            }
            label="Prompt language"
            value={value.language}
            onChange={(language) => onChange({ ...value, language })}
          />
        </>
      ) : null}
    </DetailSection>
  )
}
