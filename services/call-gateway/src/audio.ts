import type { SampleRate } from "./voice-adapter.js"

/** Stateful, causal windowed-sinc converter. A 16-input-sample delay permits
 * anti-alias filtering across chunk boundaries; phase is never reset per frame. */
export class Resampler {
  private history: number[] = []
  private received = 0
  private produced = 0
  constructor(
    readonly from: SampleRate,
    readonly to: SampleRate
  ) {}
  push(pcm: Buffer): Buffer {
    if (pcm.length % 2) throw new Error("PCM16 must contain complete samples")
    if (this.from === this.to) return Buffer.from(pcm)
    const base = this.received - this.history.length
    const data = [...this.history]
    for (let i = 0; i < pcm.length; i += 2) data.push(pcm.readInt16LE(i))
    this.received += pcm.length / 2
    const count =
      Math.floor((this.received * this.to) / this.from) - this.produced
    const output = Buffer.alloc(count * 2)
    const cutoff = Math.min(1, this.to / this.from) * 0.9
    for (let i = 0; i < count; i++) {
      const center = (this.produced++ * this.from) / this.to - 16
      let sum = 0,
        weight = 0
      for (let j = Math.ceil(center - 16); j <= Math.floor(center + 16); j++) {
        const distance = center - j
        const x = Math.PI * distance * cutoff
        const tap =
          cutoff *
          (Math.abs(x) < 1e-10 ? 1 : Math.sin(x) / x) *
          (0.5 + 0.5 * Math.cos((Math.PI * distance) / 16))
        sum += (data[j - base] ?? 0) * tap
        weight += tap
      }
      output.writeInt16LE(
        Math.max(-32768, Math.min(32767, Math.round(sum / weight))),
        i * 2
      )
    }
    this.history = data.slice(-64)
    return output
  }
}

export function decodeMuLaw(byte: number): number {
  const value = ~byte & 255
  const magnitude = (((value & 15) << 3) + 132) << ((value >> 4) & 7)
  return value & 128 ? 132 - magnitude : magnitude - 132
}
export function encodeMuLaw(sample: number): number {
  const sign = sample < 0 ? 128 : 0
  const magnitude = Math.min(32635, Math.abs(sample)) + 132
  let exponent = 7
  for (
    let mask = 0x4000;
    exponent > 0 && !(magnitude & mask);
    exponent--, mask >>= 1
  ) {}
  return ~(sign | (exponent << 4) | ((magnitude >> (exponent + 3)) & 15)) & 255
}

/** Fixed 20ms frames, three-packet playout delay, bounded reorder window.
 * Missing frames conceal with silence; late/duplicate/foreign SSRCs are dropped. */
export class JitterBuffer {
  private packets = new Map<number, Buffer>()
  private next?: number
  private ssrc?: number
  private started = false
  private waits = 0
  readonly stats = { received: 0, late: 0, lost: 0, rejected: 0 }
  push(sequence: number, ssrc: number, payload: Buffer) {
    if (this.ssrc !== undefined && this.ssrc !== ssrc) {
      this.stats.rejected++
      return
    }
    this.ssrc = ssrc
    this.next ??= sequence
    const distance = (sequence - this.next + 65536) % 65536
    if (distance > 65500) {
      if (!this.started) this.next = sequence
      else {
        this.stats.late++
        return
      }
    } else if (distance >= 50) {
      this.stats.rejected++
      return
    }
    if (this.packets.has(sequence)) return
    this.packets.set(sequence, payload)
    this.stats.received++
  }
  take(): Buffer | undefined {
    if (this.next === undefined) return undefined
    if (!this.started) {
      if (++this.waits < 3) return undefined
      this.started = true
    }
    const result = this.packets.get(this.next)
    this.packets.delete(this.next)
    this.next = (this.next + 1) & 65535
    if (!result) this.stats.lost++
    return result
  }
  skip(frames: number) {
    for (let i = 0; i < Math.min(frames, 3000); i++) this.take()
  }
}

export interface PlaybackFrame {
  pcm: Buffer
  turnId: string
  timestampMs: number
}
export class PlaybackQueue {
  private frames: PlaybackFrame[] = []
  private pending: Buffer = Buffer.alloc(0)
  private pendingTurn?: string
  private pendingTimestampMs = 0
  private played = 0
  private currentTurn?: string
  private converters = new Map<SampleRate, Resampler>()
  private cancelled = new Set<string>()
  constructor(readonly rate: SampleRate) {}
  get queuedMs() {
    return this.frames.length * 20
  }
  get playedMs() {
    return this.played
  }
  push(pcm: Buffer, from: SampleRate, turnId: string, timestampMs: number) {
    if (
      ![8000, 16000, 24000].includes(from) ||
      !Number.isFinite(timestampMs) ||
      timestampMs < 0 ||
      !turnId ||
      turnId.length > 256 ||
      !Buffer.isBuffer(pcm)
    )
      throw new Error("Invalid adapter audio")
    if (pcm.length > from * 2 * 10)
      throw new Error("Adapter chunk exceeds ten seconds")
    if (this.cancelled.has(turnId)) return
    if (this.pendingTurn !== turnId) {
      this.pending = Buffer.alloc(0)
      this.converters.clear()
      this.pendingTurn = turnId
      this.pendingTimestampMs = timestampMs
    }
    let converter = this.converters.get(from)
    if (!converter) {
      converter = new Resampler(from, this.rate)
      this.converters.set(from, converter)
    }
    const converted = converter.push(pcm)
    const frameBytes = (this.rate / 50) * 2
    if (this.queuedMs + (converted.length / 2 / this.rate) * 1000 > 10000)
      throw new Error("Playback queue exceeds ten seconds")
    this.pending = Buffer.concat([this.pending, converted])
    while (this.pending.length >= frameBytes) {
      this.frames.push({
        pcm: Buffer.from(this.pending.subarray(0, frameBytes)),
        turnId,
        timestampMs: this.pendingTimestampMs,
      })
      this.pending = this.pending.subarray(frameBytes)
      this.pendingTimestampMs += 20
    }
  }
  take(): PlaybackFrame | undefined {
    return this.frames.shift()
  }
  markSent(frame: PlaybackFrame) {
    if (this.currentTurn !== frame.turnId) {
      this.currentTurn = frame.turnId
      this.played = 0
    }
    this.played += 20
  }
  flush() {
    const result = {
      playedMs: this.played,
      flushedMs: this.queuedMs,
      turnId: this.currentTurn,
    }
    if (this.currentTurn) this.cancelled.add(this.currentTurn)
    for (const frame of this.frames) this.cancelled.add(frame.turnId)
    if (this.pendingTurn) this.cancelled.add(this.pendingTurn)
    this.frames = []
    this.pending = Buffer.alloc(0)
    this.converters.clear()
    this.pendingTurn = undefined
    return result
  }
}
