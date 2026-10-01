import { createSocket, type Socket as UdpSocket } from "node:dgram"
import { lookup } from "node:dns/promises"
import { randomBytes, randomUUID } from "node:crypto"
import { isIP } from "node:net"
import Srf from "drachtio-srf"
import {
  decodeMuLaw,
  encodeMuLaw,
  JitterBuffer,
  PlaybackQueue,
  Resampler,
} from "./audio.js"
import type { SampleRate, VoiceAgentAdapter } from "./voice-adapter.js"
import type { VoiceEvent } from "./voice-backend.js"

export interface MediaOffer {
  address: string
  port: number
  codec: "L16" | "PCMU"
  rate: SampleRate
  payload: number
}
/** Accept only one mono RTP/AVP audio m-line and a supported 20ms codec. */
export function mediaOffer(sdp: string): MediaOffer {
  if (sdp.length > 16384) throw new Error("SDP too large")
  const lines = sdp.split(/\r?\n/)
  const media = lines.filter((line) => line.startsWith("m="))
  const match = media[0]?.match(/^m=audio (\d+) RTP\/AVP ([\d ]+)$/)
  const connections = lines.filter((line) => line.startsWith("c="))
  const address = connections.at(-1)?.match(/^c=IN IP4 (\S+)$/)?.[1]
  const port = Number(match?.[1])
  if (
    media.length !== 1 ||
    !match ||
    !address ||
    isIP(address) !== 4 ||
    port < 1 ||
    port > 65535
  )
    throw new Error("Unsupported media SDP")
  if (
    lines.some((line) => line.startsWith("a=ptime:") && line !== "a=ptime:20")
  )
    throw new Error("Expected 20ms RTP")
  const payloads = match[2].split(" ").map(Number)
  const l16 = lines
    .map((line) => line.match(/^a=rtpmap:(\d+) L16\/16000(?:\/1)?$/i))
    .find((entry) => entry && payloads.includes(Number(entry[1])))
  if (l16)
    return { address, port, codec: "L16", rate: 16000, payload: Number(l16[1]) }
  if (payloads.includes(0))
    return { address, port, codec: "PCMU", rate: 8000, payload: 0 }
  throw new Error("L16/16000 or PCMU required")
}

export function rtpPayload(
  packet: Buffer,
  payloadType: number
):
  | { sequence: number; ssrc: number; payload: Buffer; timestamp: number }
  | undefined {
  if (
    packet.length < 12 ||
    packet[0] >> 6 !== 2 ||
    (packet[1] & 127) !== payloadType
  )
    return
  let start = 12 + (packet[0] & 15) * 4
  if (packet[0] & 16) {
    if (packet.length < start + 4) return
    start += 4 + packet.readUInt16BE(start + 2) * 4
  }
  const padding = packet[0] & 32 ? packet[packet.length - 1] : 0
  if (packet[0] & 32 && padding === 0) return
  const end = packet.length - padding
  if (start >= end) return
  return {
    sequence: packet.readUInt16BE(2),
    timestamp: packet.readUInt32BE(4),
    ssrc: packet.readUInt32BE(8),
    payload: packet.subarray(start, end),
  }
}

export class VoiceMediaSession {
  readonly jitter = new JitterBuffer()
  readonly playback: PlaybackQueue
  private readonly input: Resampler
  private timer?: NodeJS.Timeout
  private stopped = false
  private sent = 0
  private tickCount = 0
  private readonly origin = performance.now()
  private lastTick = this.origin
  private nextTick = 0
  private maxTickDelayMs = 0
  private firstInputMs?: number
  private firstOutputMs?: number
  private sequence = randomBytes(2).readUInt16BE()
  private timestamp = randomBytes(4).readUInt32BE()
  private readonly ssrc = randomBytes(4).readUInt32BE()
  private readonly unsubscribe: (() => void)[] = []
  constructor(
    private readonly socket: UdpSocket,
    readonly offer: MediaOffer,
    private readonly adapter: VoiceAgentAdapter,
    private readonly event: (event: VoiceEvent) => void,
    private readonly barge: () => Promise<unknown>,
    private readonly end: (reason: string) => void
  ) {
    this.playback = new PlaybackQueue(offer.rate)
    this.input = new Resampler(offer.rate, 16000)
    socket.on("message", (packet, remote) => {
      if (
        remote.address !== offer.address ||
        remote.port !== offer.port ||
        this.stopped
      )
        return
      const rtp = rtpPayload(packet, offer.payload)
      const expected = (offer.rate / 50) * (offer.codec === "L16" ? 2 : 1)
      if (!rtp || rtp.payload.length !== expected) return
      this.firstInputMs ??= performance.now() - this.origin
      this.jitter.push(rtp.sequence, rtp.ssrc, rtp.payload)
    })
    socket.on("error", () => this.end("RTP socket failed"))
    this.unsubscribe.push(
      adapter.onAudio((audio) => {
        if (this.stopped) return
        try {
          this.playback.push(
            audio.pcm,
            audio.sampleRate,
            audio.turnId,
            audio.timestampMs
          )
        } catch {
          this.end("Invalid adapter audio or playback overflow")
        }
      }),
      adapter.onBargeIn(() => {
        if (this.stopped) return
        const flushed = this.playback.flush()
        this.event({ type: "barge_in", ...flushed })
        adapter.interrupt(flushed.playedMs)
        void this.barge().catch(() => this.end("Barge-in control failed"))
      }),
      adapter.onEnd((reason) => this.end(reason))
    )
  }
  async start() {
    await this.adapter.start()
    if (!this.stopped) {
      this.lastTick = performance.now()
      this.nextTick = this.lastTick + 20
      this.schedule()
    }
  }
  private schedule() {
    if (this.stopped) return
    this.timer = setTimeout(
      () => {
        this.tick()
        this.nextTick += 20
        this.schedule()
      },
      Math.max(1, Math.ceil(this.nextTick - performance.now()))
    )
  }
  private tick() {
    if (this.stopped) return
    const now = performance.now()
    const delay = now - this.lastTick - 20
    this.maxTickDelayMs = Math.max(this.maxTickDelayMs, delay)
    this.lastTick = now
    const missed = Math.max(0, Math.floor((now - this.nextTick) / 20))
    if (missed) {
      this.nextTick += missed * 20
      this.jitter.skip(missed)
      this.tickCount += missed
      this.timestamp = (this.timestamp + (missed * this.offer.rate) / 50) >>> 0
    }
    const payload = this.jitter.take()
    // No synthetic provider input before the receive jitter buffer starts.
    if (payload || this.jitter.stats.received >= 3) {
      const pcm = Buffer.alloc((this.offer.rate / 50) * 2)
      if (payload)
        for (let i = 0; i < pcm.length / 2; i++)
          pcm.writeInt16LE(
            this.offer.codec === "L16"
              ? payload.readInt16BE(i * 2)
              : decodeMuLaw(payload[i]),
            i * 2
          )
      try {
        this.adapter.pushAudio({
          pcm: this.input.push(pcm),
          sampleRate: 16000,
          timestampMs: this.tickCount * 20,
          turnId: "caller",
        })
      } catch {
        this.end("Adapter input failed")
        return
      }
    }
    const frame = this.playback.take()
    const pcm = frame?.pcm ?? Buffer.alloc((this.offer.rate / 50) * 2)
    const encoded = Buffer.alloc(
      (this.offer.rate / 50) * (this.offer.codec === "L16" ? 2 : 1)
    )
    for (let i = 0; i < pcm.length / 2; i++) {
      const sample = pcm.readInt16LE(i * 2)
      if (this.offer.codec === "L16") encoded.writeInt16BE(sample, i * 2)
      else encoded[i] = encodeMuLaw(sample)
    }
    const packet = Buffer.alloc(12 + encoded.length)
    packet[0] = 128
    packet[1] = this.offer.payload
    packet.writeUInt16BE(this.sequence++ & 65535, 2)
    packet.writeUInt32BE(this.timestamp >>> 0, 4)
    packet.writeUInt32BE(this.ssrc, 8)
    encoded.copy(packet, 12)
    this.socket.send(packet, this.offer.port, this.offer.address, (error) => {
      if (error && !this.stopped) this.end("RTP send failed")
    })
    if (frame) {
      this.playback.markSent(frame)
      this.firstOutputMs ??= now - this.origin
    }
    this.sent++
    this.tickCount++
    this.timestamp = (this.timestamp + this.offer.rate / 50) >>> 0
    // Never catch up with bursts after an event-loop stall: one packet per tick.
  }
  async stop() {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer)
    for (const remove of this.unsubscribe) remove()
    this.event({
      type: "media",
      codec: this.offer.codec,
      received: this.jitter.stats.received,
      sent: this.sent,
      playedMs: this.playback.playedMs,
      lost: this.jitter.stats.lost,
      late: this.jitter.stats.late,
      maxTickDelayMs: Math.round(this.maxTickDelayMs),
      firstInputMs: this.firstInputMs,
      firstOutputMs: this.firstOutputMs,
    })
    this.socket.close()
    this.playback.flush()
    await this.adapter.stop()
  }
}

interface Reservation {
  claimed?: boolean
  closed?: boolean
  attach: (session: VoiceMediaSession) => Promise<void>
  adapter: VoiceAgentAdapter
  event: (event: VoiceEvent) => void
  barge: () => Promise<unknown>
  end: (reason: string) => void
}

/** drachtio handles SIP only; RTP terminates in this Node process. Unpredictable,
 * one-shot Request-URI tokens correlate only controller-authorized bridges. */
export class VoiceMediaEndpoint {
  private readonly srf = new Srf()
  private ready = false
  private address = ""
  private fsAddress = ""
  private readonly reservations = new Map<string, Reservation>()
  private readonly sessions = new Map<
    string,
    { media: VoiceMediaSession; dialog: Srf.Dialog }
  >()
  constructor(
    private readonly options: {
      host: string
      port: number
      secret: string
      advertiseHost: string
      fsHost: string
    }
  ) {
    this.srf.on("connect", (error) => {
      this.ready = !error
    })
    this.srf.on("error", () => {
      this.ready = false
    })
    this.srf.on("disconnect", () => {
      this.ready = false
      for (const { media } of this.sessions.values()) void media.stop()
      for (const reservation of this.reservations.values())
        reservation.end("drachtio disconnected")
    })
    this.srf.invite((request, response) => {
      void this.invite(request, response)
    })
  }
  get healthy() {
    return this.ready
  }
  async start() {
    this.address = (
      await lookup(this.options.advertiseHost, { family: 4 })
    ).address
    this.fsAddress = (await lookup(this.options.fsHost, { family: 4 })).address
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.srf.disconnect()
        reject(new Error("drachtio connect timed out"))
      }, 10000)
      this.srf.once("connect", (error) => {
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      })
      this.srf.connect({
        host: this.options.host,
        port: this.options.port,
        secret: this.options.secret,
      })
    })
  }
  reserve(reservation: Reservation) {
    if (!this.ready) throw new Error("drachtio unavailable")
    const token = randomUUID()
    this.reservations.set(token, reservation)
    return {
      uri: `sip:${token}@${this.options.host}:5060`,
      release: async () => {
        reservation.closed = true
        this.reservations.delete(token)
        const session = this.sessions.get(token)
        if (session) {
          this.sessions.delete(token)
          session.dialog.destroy()
          await session.media.stop()
        } else await reservation.adapter.stop()
      },
    }
  }
  private async invite(request: Srf.SrfRequest, response: Srf.SrfResponse) {
    const token = Srf.parseUri(request.uri)?.user ?? ""
    const reservation = this.reservations.get(token)
    if (
      !reservation ||
      reservation.closed ||
      reservation.claimed ||
      request.source_address !== this.fsAddress
    ) {
      response.send(403)
      return
    }
    reservation.claimed = true
    let socket: UdpSocket | undefined
    let media: VoiceMediaSession | undefined
    let cancelled = false
    request.on("cancel", () => {
      cancelled = true
    })
    try {
      const offer = mediaOffer(request.body)
      if (offer.address !== this.fsAddress)
        throw new Error("Media must come from FreeSWITCH")
      socket = createSocket("udp4")
      await new Promise<void>((resolve, reject) => {
        socket!.once("error", reject)
        socket!.bind(0, "0.0.0.0", () => {
          socket!.off("error", reject)
          resolve()
        })
      })
      if (cancelled || reservation.closed) throw new Error("INVITE cancelled")
      const localSdp = [
        "v=0",
        `o=- ${Date.now()} 1 IN IP4 ${this.address}`,
        "s=opensend-voice",
        `c=IN IP4 ${this.address}`,
        "t=0 0",
        `m=audio ${socket.address().port} RTP/AVP ${offer.payload}`,
        `a=rtpmap:${offer.payload} ${offer.codec}/${offer.rate}`,
        "a=ptime:20",
        "a=maxptime:20",
        "a=sendrecv",
        "",
      ].join("\r\n")
      media = new VoiceMediaSession(
        socket,
        offer,
        reservation.adapter,
        reservation.event,
        reservation.barge,
        reservation.end
      )
      const dialog = await this.srf.createUAS(request, response, { localSdp })
      if (reservation.closed) {
        dialog.destroy()
        await media.stop()
        return
      }
      this.sessions.set(token, { dialog, media })
      dialog.on("modify", (_req, res) => res.send(488))
      dialog.on("destroy", () => {
        this.sessions.delete(token)
        this.reservations.delete(token)
        void media!.stop()
        reservation.end("Bot SIP leg ended")
      })
      await reservation.attach(media)
    } catch {
      this.sessions.delete(token)
      this.reservations.delete(token)
      if (!response.finalResponseSent && !cancelled) response.send(488)
      if (media) await media.stop()
      else {
        socket?.close()
        await reservation.adapter.stop()
      }
      reservation.end("Bot media setup failed")
    }
  }
  async close() {
    for (const { media, dialog } of this.sessions.values()) {
      dialog.destroy()
      await media.stop()
    }
    this.sessions.clear()
    this.reservations.clear()
    this.ready = false
    this.srf.disconnect()
  }
}
