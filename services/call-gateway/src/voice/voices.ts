/** Provider-published voice genders; custom voice IDs remain unknown.
 * Google: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd#voice_options
 * Sarvam: https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/how-to/change-the-speaker-voice
 * Sarah: https://github.com/elevenlabs/plugin/blob/main/skills/general/text-to-speech/SKILL.md
 * Adam: https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming
 * ElevenLabs: https://elevenlabs.io/docs/api-reference/voices/get (labels.gender)
 */
export type VoiceGender = "female" | "male" | "unknown"
export const VOICE_CATALOG = {
  gemini: [
    { value: "Zephyr", label: "Zephyr", gender: "female" },
    { value: "Puck", label: "Puck", gender: "male" },
    { value: "Charon", label: "Charon", gender: "male" },
    { value: "Kore", label: "Kore", gender: "female" },
    { value: "Fenrir", label: "Fenrir", gender: "male" },
    { value: "Leda", label: "Leda", gender: "female" },
    { value: "Orus", label: "Orus", gender: "male" },
    { value: "Aoede", label: "Aoede", gender: "female" },
    { value: "Callirrhoe", label: "Callirrhoe", gender: "female" },
    { value: "Autonoe", label: "Autonoe", gender: "female" },
    { value: "Enceladus", label: "Enceladus", gender: "male" },
    { value: "Iapetus", label: "Iapetus", gender: "male" },
    { value: "Umbriel", label: "Umbriel", gender: "male" },
    { value: "Algieba", label: "Algieba", gender: "male" },
    { value: "Despina", label: "Despina", gender: "female" },
    { value: "Erinome", label: "Erinome", gender: "female" },
    { value: "Algenib", label: "Algenib", gender: "male" },
    { value: "Rasalgethi", label: "Rasalgethi", gender: "male" },
    { value: "Laomedeia", label: "Laomedeia", gender: "female" },
    { value: "Achernar", label: "Achernar", gender: "female" },
    { value: "Alnilam", label: "Alnilam", gender: "male" },
    { value: "Schedar", label: "Schedar", gender: "male" },
    { value: "Gacrux", label: "Gacrux", gender: "female" },
    { value: "Pulcherrima", label: "Pulcherrima", gender: "female" },
    { value: "Achird", label: "Achird", gender: "male" },
    { value: "Zubenelgenubi", label: "Zubenelgenubi", gender: "male" },
    { value: "Vindemiatrix", label: "Vindemiatrix", gender: "female" },
    { value: "Sadachbia", label: "Sadachbia", gender: "male" },
    { value: "Sadaltager", label: "Sadaltager", gender: "male" },
    { value: "Sulafat", label: "Sulafat", gender: "female" },
  ],
  sarvam: [
    { value: "shubh", label: "Shubh", gender: "male" },
    { value: "aditya", label: "Aditya", gender: "male" },
    { value: "ritu", label: "Ritu", gender: "female" },
    { value: "priya", label: "Priya", gender: "female" },
    { value: "neha", label: "Neha", gender: "female" },
    { value: "rahul", label: "Rahul", gender: "male" },
    { value: "pooja", label: "Pooja", gender: "female" },
    { value: "rohan", label: "Rohan", gender: "male" },
    { value: "simran", label: "Simran", gender: "female" },
    { value: "kavya", label: "Kavya", gender: "female" },
    { value: "amit", label: "Amit", gender: "male" },
    { value: "dev", label: "Dev", gender: "male" },
    { value: "ishita", label: "Ishita", gender: "female" },
    { value: "shreya", label: "Shreya", gender: "female" },
    { value: "ratan", label: "Ratan", gender: "male" },
    { value: "varun", label: "Varun", gender: "male" },
    { value: "manan", label: "Manan", gender: "male" },
    { value: "sumit", label: "Sumit", gender: "male" },
    { value: "roopa", label: "Roopa", gender: "female" },
    { value: "kabir", label: "Kabir", gender: "male" },
    { value: "aayan", label: "Aayan", gender: "male" },
    { value: "ashutosh", label: "Ashutosh", gender: "male" },
    { value: "advait", label: "Advait", gender: "male" },
    { value: "anand", label: "Anand", gender: "male" },
    { value: "tanya", label: "Tanya", gender: "female" },
    { value: "tarun", label: "Tarun", gender: "male" },
    { value: "sunny", label: "Sunny", gender: "male" },
    { value: "mani", label: "Mani", gender: "male" },
    { value: "gokul", label: "Gokul", gender: "male" },
    { value: "vijay", label: "Vijay", gender: "male" },
    { value: "shruti", label: "Shruti", gender: "female" },
    { value: "suhani", label: "Suhani", gender: "female" },
    { value: "mohit", label: "Mohit", gender: "male" },
    { value: "kavitha", label: "Kavitha", gender: "female" },
    { value: "rehan", label: "Rehan", gender: "male" },
    { value: "soham", label: "Soham", gender: "male" },
    { value: "rupali", label: "Rupali", gender: "female" },
  ],
  elevenlabs: [
    { value: "21m00Tcm4TlvDq8ikWAM", label: "Rachel", gender: "female" },
    { value: "EXAVITQu4vr4xnSDxMaL", label: "Sarah", gender: "female" },
    { value: "pNInz6obpgDQGcFmaJgB", label: "Adam", gender: "male" },
  ],
} as const
export const GEMINI_VOICES = VOICE_CATALOG.gemini.map((v) => v.value)
export const SARVAM_VOICES = VOICE_CATALOG.sarvam.map((v) => v.value)
export function voiceGender(
  provider: keyof typeof VOICE_CATALOG,
  voice: string
): VoiceGender {
  return (
    VOICE_CATALOG[provider].find((v) => v.value === voice)?.gender ?? "unknown"
  )
}
export function botVoiceGender(config: {
  engine: string
  voice: string
  tts?: { provider: keyof typeof VOICE_CATALOG; voice?: string }
}): VoiceGender {
  return config.engine === "gemini_live"
    ? voiceGender("gemini", config.voice)
    : config.tts
      ? voiceGender(config.tts.provider, config.tts.voice ?? "")
      : "unknown"
}
