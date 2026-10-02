import { spawn } from "node:child_process"
import { GatewayError } from "./errors.js"

export const PROMPT_BYTES = 16 * 1024 * 1024
let active = 0
/** Convert once before storage. Fixed demuxers and pipe-only IO cannot open URLs/files. */
export async function normalizePrompt(audio: Buffer): Promise<Buffer> {
  if (!audio.length || audio.length > PROMPT_BYTES)
    throw new GatewayError("INVALID_AUDIO", "Prompt exceeds 16 MiB")
  const format =
    audio.subarray(0, 4).toString() === "RIFF"
      ? "wav"
      : audio.subarray(0, 4).toString() === "OggS"
        ? "ogg"
        : audio.subarray(0, 3).toString() === "ID3" ||
            (audio[0] === 255 && (audio[1] & 224) === 224)
          ? "mp3"
          : undefined
  if (!format)
    throw new GatewayError("INVALID_AUDIO", "Expected WAV, MP3 or OGG audio")
  if (active >= 2)
    throw new GatewayError("AUDIO_BUSY", "Prompt converter is busy; retry", 503)
  active++
  try {
    const deadline = Date.now() + 20000
    const run = (filter: string, analyze = false) =>
      new Promise<{ pcm: Buffer; diagnostics: string }>((resolve, reject) => {
        const child = spawn(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            analyze ? "info" : "error",
            "-nostdin",
            "-protocol_whitelist",
            "pipe",
            "-f",
            format,
            "-i",
            "pipe:0",
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-af",
            filter,
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-threads",
            "1",
            "-f",
            analyze ? "null" : "s16le",
            "pipe:1",
          ],
          { stdio: ["pipe", "pipe", "pipe"] }
        )
        const chunks: Buffer[] = []
        let size = 0,
          diagnostics = "",
          failed = false
        const fail = () => {
          if (failed) return
          failed = true
          child.kill("SIGKILL")
          reject(
            new GatewayError(
              "INVALID_AUDIO",
              "Unable to normalize prompt within audio limits"
            )
          )
        }
        const timer = setTimeout(fail, Math.max(1, deadline - Date.now()))
        child.on("error", fail)
        child.stdin.on("error", () => {
          /* Exit status reports invalid input. */
        })
        child.stderr.on("data", (chunk: Buffer) => {
          diagnostics = (diagnostics + chunk.toString()).slice(-16000)
        })
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > PROMPT_BYTES - 44) fail()
          else chunks.push(chunk)
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          if (failed) return
          if (code !== 0 || (!analyze && (!size || size % 2))) fail()
          else resolve({ pcm: Buffer.concat(chunks), diagnostics })
        })
        child.stdin.end(audio)
      })
    // Measure the actual 16k mono signal, after anti-alias filtering. Linear
    // second-pass gain preserves dynamics; loudnorm limits peaks if gain cannot.
    const resample =
      "aformat=channel_layouts=mono,aresample=16000:filter_size=64:cutoff=0.97"
    const target = "loudnorm=I=-18:TP=-2:LRA=11"
    const analysis = await run(`${resample},${target}:print_format=json`, true)
    const match = analysis.diagnostics.match(/\{[^{}]*"input_i"[^{}]*\}/)
    if (!match)
      throw new GatewayError(
        "INVALID_AUDIO",
        "Unable to measure prompt loudness"
      )
    const measured = JSON.parse(match[0]) as Record<string, string>
    const parameters = [
      "input_i",
      "input_tp",
      "input_lra",
      "input_thresh",
      "target_offset",
    ]
    const finite = parameters.every((key) =>
      Number.isFinite(Number(measured[key]))
    )
    // Silence has -inf loudness: preserve it without attempting infinite gain.
    const filter = finite
      ? `${resample},${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,aresample=16000:filter_size=64:cutoff=0.97`
      : resample
    const { pcm } = await run(filter)
    const wav = Buffer.alloc(44 + pcm.length)
    wav.write("RIFF")
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write("WAVEfmt ", 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(16000, 24)
    wav.writeUInt32LE(32000, 28)
    wav.writeUInt16LE(2, 32)
    wav.writeUInt16LE(16, 34)
    wav.write("data", 36)
    wav.writeUInt32LE(pcm.length, 40)
    pcm.copy(wav, 44)
    return wav
  } finally {
    active--
  }
}
