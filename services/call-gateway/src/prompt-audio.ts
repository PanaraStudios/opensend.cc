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
    const pcm = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
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
          "-ar",
          "48000",
          "-af",
          "aresample=48000:filter_size=64:cutoff=0.97",
          "-c:a",
          "pcm_s16le",
          "-threads",
          "1",
          "-f",
          "s16le",
          "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "ignore"] }
      )
      const chunks: Buffer[] = []
      let size = 0,
        failed = false
      const fail = () => {
        failed = true
        child.kill("SIGKILL")
        reject(
          new GatewayError(
            "INVALID_AUDIO",
            "Unable to normalize prompt within audio limits"
          )
        )
      }
      const timer = setTimeout(fail, 20000)
      child.on("error", fail)
      child.stdin.on("error", () => {
        /* Exit status reports invalid input. */
      })
      child.stdout.on("data", (chunk: Buffer) => {
        size += chunk.length
        if (size > PROMPT_BYTES - 44) fail()
        else chunks.push(chunk)
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        if (failed) return
        if (code !== 0 || !size || size % 2) fail()
        else resolve(Buffer.concat(chunks))
      })
      child.stdin.end(audio)
    })
    const wav = Buffer.alloc(44 + pcm.length)
    wav.write("RIFF")
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write("WAVEfmt ", 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(1, 20)
    wav.writeUInt16LE(1, 22)
    wav.writeUInt32LE(48000, 24)
    wav.writeUInt32LE(96000, 28)
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
