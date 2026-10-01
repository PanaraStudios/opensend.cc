/** Harness-only real libopus codec checks; absent from the gateway runtime. */
import { createRequire } from "node:module"
const OpusScript = createRequire(import.meta.url)(
  "opusscript"
) as typeof import("opusscript")

export async function opusTone(frequency: number) {
  const encoder = new OpusScript(48000, 1, OpusScript.Application.VOIP)
  try {
    return Array.from({ length: 50 }, (_, frame) => {
      const pcm = Buffer.alloc(960 * 2)
      for (let i = 0; i < 960; i++)
        pcm.writeInt16LE(
          Math.round(
            4000 *
              Math.sin((2 * Math.PI * frequency * (frame * 960 + i)) / 48000)
          ),
          i * 2
        )
      return Buffer.from(encoder.encode(pcm, 960))
    })
  } finally {
    encoder.delete()
  }
}
export async function decodeOpus(packets: Buffer[]) {
  const decoder = new OpusScript(16000, 1, OpusScript.Application.VOIP)
  try {
    return Buffer.concat(
      packets.map((packet) => Buffer.from(decoder.decode(packet)))
    )
  } finally {
    decoder.delete()
  }
}
export function tonePower(pcm: Buffer, frequency: number) {
  // Average 100ms windows so packet concealment/phase jumps cannot cancel a
  // present speech tone across the entire capture.
  let power = 0,
    windows = 0
  for (let start = 0; start < pcm.length / 2; start += 1600) {
    const count = Math.min(1600, pcm.length / 2 - start)
    if (count < 320) break
    let real = 0,
      imaginary = 0
    for (let i = 0; i < count; i++) {
      const value = pcm.readInt16LE((start + i) * 2),
        phase = (2 * Math.PI * frequency * i) / 16000
      real += value * Math.cos(phase)
      imaginary += value * Math.sin(phase)
    }
    power += Math.hypot(real, imaginary) / count
    windows++
  }
  return power / Math.max(1, windows)
}
