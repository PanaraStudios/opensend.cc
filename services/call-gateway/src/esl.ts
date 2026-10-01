import { EventEmitter } from "node:events"
import { createConnection, type Socket } from "node:net"
import { GatewayError } from "./errors.js"

export interface EslFrame {
  headers: Record<string, string>
  body: string
}
export function parseHeaders(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.includes(":"))
      .map((line) => {
        const at = line.indexOf(":")
        return [
          line.slice(0, at),
          decodeURIComponent(line.slice(at + 1).trim()),
        ]
      })
  )
}
/** Content-Length is bytes, including for event bodies with non-ASCII text. */
export class EslFrames {
  private buffer: Buffer = Buffer.alloc(0)
  push(chunk: Buffer): EslFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    if (this.buffer.length > 2 * 1024 * 1024)
      throw new Error("ESL frame too large")
    const frames: EslFrame[] = []
    while (true) {
      const lf = this.buffer.indexOf("\n\n"),
        crlf = this.buffer.indexOf("\r\n\r\n")
      const at = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf
      if (at < 0) break
      const delimiter = at === crlf ? 4 : 2
      const headers = parseHeaders(this.buffer.subarray(0, at).toString())
      const length = Number(headers["Content-Length"] ?? 0)
      if (!Number.isSafeInteger(length) || length < 0 || length > 1024 * 1024)
        throw new Error("Invalid ESL length")
      const start = at + delimiter,
        end = start + length
      if (this.buffer.length < end) break
      frames.push({
        headers,
        body: this.buffer.subarray(start, end).toString(),
      })
      this.buffer = this.buffer.subarray(end)
    }
    return frames
  }
}

export class FreeSwitch extends EventEmitter {
  private socket?: Socket
  private connected = false
  private serial: Promise<unknown> = Promise.resolve()
  private reply?: {
    resolve: (frame: EslFrame) => void
    reject: (error: Error) => void
  }
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly secret: string
  ) {
    super()
  }
  async open(): Promise<void> {
    if (/[\r\n]/.test(this.secret)) throw new Error("Invalid ESL secret")
    const frames = new EslFrames()
    const socket = (this.socket = createConnection({
      host: this.host,
      port: this.port,
    }))
    const challenge = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error("ESL connection timed out"))
      }, 5000)
      socket.once("error", reject)
      this.once("challenge", () => {
        clearTimeout(timer)
        resolve()
      })
    })
    socket.on("data", (chunk) => {
      try {
        for (const frame of frames.push(chunk)) {
          const type = frame.headers["Content-Type"]
          if (type === "auth/request") this.emit("challenge")
          else if (type === "text/event-plain")
            this.emit("event", parseHeaders(frame.body))
          else if (type === "command/reply" || type === "api/response") {
            const reply = this.reply
            this.reply = undefined
            reply?.resolve(frame)
          } else if (
            type === "text/disconnect-notice" ||
            type === "text/rude-rejection"
          )
            socket.destroy()
        }
      } catch {
        socket.destroy()
      }
    })
    socket.on("error", () => {
      /* Close reports loss to the controller. */
    })
    socket.on("close", () => {
      this.connected = false
      this.reply?.reject(
        new GatewayError("ESL_UNAVAILABLE", "FreeSWITCH disconnected", 502)
      )
      this.reply = undefined
      this.emit("failure", new Error("FreeSWITCH disconnected"))
    })
    await challenge
    await this.command(`auth ${this.secret}`)
    this.connected = true
    await this.command(
      "event plain CHANNEL_PARK CHANNEL_HANGUP CHANNEL_HANGUP_COMPLETE RECORD_STOP BACKGROUND_JOB"
    )
  }
  get ready() {
    return this.connected
  }
  command(command: string): Promise<EslFrame> {
    if (/[\r\n]/.test(command))
      return Promise.reject(new Error("ESL command injection"))
    const operation = this.serial.then(
      () =>
        new Promise<EslFrame>((resolve, reject) => {
          if (!this.socket || this.socket.destroyed)
            return reject(
              new GatewayError(
                "ESL_UNAVAILABLE",
                "FreeSWITCH is unavailable",
                502
              )
            )
          const timer = setTimeout(() => {
            this.socket?.destroy()
            reject(
              new GatewayError(
                "ESL_TIMEOUT",
                "FreeSWITCH command timed out",
                504
              )
            )
          }, 10000)
          this.reply = {
            resolve: (frame) => {
              clearTimeout(timer)
              const text = frame.body || frame.headers["Reply-Text"] || ""
              if (text.startsWith("-ERR"))
                reject(new GatewayError("ESL_ERROR", text.trim(), 502))
              else resolve(frame)
            },
            reject: (error) => {
              clearTimeout(timer)
              reject(error)
            },
          }
          this.socket.write(`${command}\n\n`)
        })
    )
    this.serial = operation.catch(() => undefined)
    return operation
  }
  async api(command: string): Promise<string> {
    return (await this.command(`api ${command}`)).body.trim()
  }
  async bgapi(command: string): Promise<void> {
    await this.command(`bgapi ${command}`)
  }
  close() {
    this.connected = false
    this.socket?.destroy()
  }
}
