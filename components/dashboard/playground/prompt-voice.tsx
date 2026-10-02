"use client"
import { Field, FieldLabel } from "@/components/ui/field"
import { ProviderKeySelect } from "./provider-keys"
import { DetailSection, OptionSelect } from "@/components/dashboard/primitives"
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
  return (
    <DetailSection title="Prompt voice">
      <p className="text-sm text-muted-foreground">
        Choose a voice for typed prompts, or upload your own audio.
      </p>
      <Field>
        <FieldLabel>Prompt provider</FieldLabel>
        <OptionSelect
          aria-label="Prompt provider"
          value={value?.provider ?? "none"}
          items={[
            { value: "none", label: "Upload audio instead" },
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
                    voice: provider === "sarvam" ? "shubh" : "21m00Tcm4TlvDq8ikWAM",
                    language: provider === "sarvam" ? "en-IN" : "en",
                  }
            )
          }
        />
      </Field>
      {value ? (
        <>
          <ProviderKeySelect
            label="Prompt provider key"
            provider={value.provider}
            value={value.credentialId}
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
