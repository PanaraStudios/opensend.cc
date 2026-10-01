import type { PromptRenderer } from "./ivr-prompts"
export const IVR_TTS_PROVIDERS = ["elevenlabs", "sarvam"] as const
export const SARVAM_PROMPT_VOICES = [
  "shubh",
  "aditya",
  "ritu",
  "priya",
  "neha",
  "rahul",
  "pooja",
  "rohan",
  "simran",
  "kavya",
  "amit",
  "dev",
  "ishita",
  "shreya",
  "ratan",
  "varun",
  "manan",
  "sumit",
  "roopa",
  "kabir",
  "aayan",
  "ashutosh",
  "advait",
  "anand",
  "tanya",
  "tarun",
  "sunny",
  "mani",
  "gokul",
  "vijay",
  "shruti",
  "suhani",
  "mohit",
  "kavitha",
  "rehan",
  "soham",
  "rupali",
] as const
export interface IvrPromptVoice {
  provider: "elevenlabs" | "sarvam"
  voice: string
  language: string
  credentialId: string
}
export function promptRendererName(provider: IvrPromptVoice["provider"]) {
  return provider === "sarvam"
    ? "sarvam-bulbul-v3-pcm16k-v1"
    : "elevenlabs-multilingual-v2-pcm16k-v1"
}
export function pcmWav(pcm: Uint8Array): Blob {
  if (!pcm.length || pcm.length % 2 || pcm.length > 16 * 1024 * 1024 - 44)
    throw new Error("Invalid provider PCM audio")
  const bytes = new Uint8Array(44 + pcm.length),
    view = new DataView(bytes.buffer),
    text = new TextEncoder()
  bytes.set(text.encode("RIFF"), 0)
  view.setUint32(4, bytes.length - 8, true)
  bytes.set(text.encode("WAVEfmt "), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  bytes.set(text.encode("data"), 36)
  view.setUint32(40, pcm.length, true)
  bytes.set(pcm, 44)
  return new Blob([bytes], { type: "audio/wav" })
}
async function bounded(
  response: Response,
  max = 16 * 1024 * 1024
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Empty provider response")
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) throw new Error("Provider audio exceeds limit")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
  const result = new Uint8Array(size)
  let at = 0
  for (const c of chunks) {
    result.set(c, at)
    at += c.length
  }
  return result
}
export class PromptProviderError extends Error {
  constructor(readonly retryable: boolean) {
    super(
      "Voice provider could not render this prompt. Check the key, voice and language, then retry."
    )
  }
}
function status(response: Response) {
  if (!response.ok)
    throw new PromptProviderError(
      response.status === 429 || response.status >= 500
    )
}
export class ElevenLabsPromptRenderer implements PromptRenderer {
  readonly name = promptRendererName("elevenlabs")
  constructor(
    private readonly key: string,
    private readonly request: typeof fetch = fetch
  ) {}
  async render(text: string, language: string, voice?: string) {
    const r = await this.request(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice ?? "")}?output_format=pcm_16000`,
      {
        method: "POST",
        headers: { "xi-api-key": this.key, "content-type": "application/json" },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          language_code: language.split("-")[0],
        }),
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      }
    )
    status(r)
    return { audio: pcmWav(await bounded(r)) }
  }
}
export class SarvamPromptRenderer implements PromptRenderer {
  readonly name = promptRendererName("sarvam")
  constructor(
    private readonly key: string,
    private readonly request: typeof fetch = fetch
  ) {}
  async render(text: string, language: string, voice?: string) {
    const r = await this.request("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": this.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        text,
        language_code: language,
        speaker: voice,
        model: "bulbul:v3",
        speech_sample_rate: 16000,
        output_audio_codec: "wav",
      }),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    })
    status(r)
    const value: unknown = JSON.parse(
      new TextDecoder().decode(await bounded(r, 24 * 1024 * 1024))
    )
    if (
      !value ||
      typeof value !== "object" ||
      !("audios" in value) ||
      !Array.isArray(value.audios) ||
      value.audios.length !== 1 ||
      typeof value.audios[0] !== "string"
    )
      throw new Error("Invalid provider audio response")
    const audio = Uint8Array.from(atob(value.audios[0]), (c) => c.charCodeAt(0))
    // Request WAV PCM explicitly, and refuse a mismatched container instead of sending it to ESL.
    const view = new DataView(audio.buffer)
    if (
      audio.length < 44 ||
      audio.length > 16 * 1024 * 1024 ||
      new TextDecoder().decode(audio.slice(0, 4)) !== "RIFF" ||
      new TextDecoder().decode(audio.slice(8, 12)) !== "WAVE"
    )
      throw new Error("Invalid provider WAV audio")
    let fmt = false
    for (let at = 12; at + 8 <= audio.length;) {
      const length = view.getUint32(at + 4, true)
      if (at + 8 + length > audio.length)
        throw new Error("Truncated provider WAV")
      if (new TextDecoder().decode(audio.slice(at, at + 4)) === "fmt ") {
        fmt =
          length >= 16 &&
          view.getUint16(at + 8, true) === 1 &&
          view.getUint16(at + 10, true) === 1 &&
          view.getUint32(at + 12, true) === 16000 &&
          view.getUint16(at + 22, true) === 16
      }
      at += 8 + length + (length % 2)
    }
    if (!fmt) throw new Error("Provider must return 16 kHz mono PCM WAV")
    return { audio: new Blob([audio], { type: "audio/wav" }) }
  }
}
export async function renderWithBackoff(
  renderer: PromptRenderer,
  text: string,
  language: string,
  voice: string,
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
) {
  for (let attempt = 0; ; attempt++)
    try {
      return await renderer.render(text, language, voice)
    } catch (e) {
      if (attempt === 2 || (e instanceof PromptProviderError && !e.retryable))
        throw e
      await sleep(250 * 4 ** attempt)
    }
}
