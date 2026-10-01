import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"
import { createServer, type Socket } from "node:net"
import { EslFrames, parseHeaders, type EslFrame } from "./esl.js"

const safeLine = (value: string) => {
  if (/[\r\n\0]/.test(value)) throw new Error("ESL command injection")
  return value
}

/** One FreeSWITCH-initiated async/full socket. Command acknowledgement and
 * application completion are distinct, correlated by Event-UUID. */
export class OutboundCall extends EventEmitter {
  uuid = ""
  private serial: Promise<unknown> = Promise.resolve()
  private reply?: {
    resolve: (frame: EslFrame) => void
    reject: (error: Error) => void
  }
  private applications = new Map<
    string,
    {
      resolve: (event: Record<string, string>) => void
      reject: (error: Error) => void
    }
  >()
  constructor(private readonly socket: Socket) {
    super()
    const frames = new EslFrames()
    socket.on("data", (chunk) => {
      try {
        for (const frame of frames.push(chunk)) {
          if (frame.headers["Content-Type"] === "text/event-plain") {
            const event = parseHeaders(frame.body)
            if (event["Unique-ID"] !== this.uuid) continue
            if (event["Event-Name"] === "CHANNEL_EXECUTE_COMPLETE")
              this.applications.get(event["Application-UUID"])?.resolve(event)
            this.emit("event", event)
          } else if (
            ["command/reply", "api/response"].includes(
              frame.headers["Content-Type"]
            )
          ) {
            const reply = this.reply
            this.reply = undefined
            const text = frame.body || frame.headers["Reply-Text"] || ""
            if (text.startsWith("-ERR")) reply?.reject(new Error(text.trim()))
            else reply?.resolve(frame)
          } else if (frame.headers["Content-Type"] === "text/disconnect-notice")
            socket.end()
        }
      } catch {
        socket.destroy()
      }
    })
    socket.on("error", () => {
      /* close rejects all waiters */
    })
    socket.on("close", () => {
      const error = new Error("Outbound ESL disconnected")
      this.reply?.reject(error)
      this.reply = undefined
      for (const app of this.applications.values()) app.reject(error)
      this.applications.clear()
      this.emit("close")
    })
  }
  private command(text: string): Promise<EslFrame> {
    const operation = this.serial.then(
      () =>
        new Promise<EslFrame>((resolve, reject) => {
          if (this.socket.destroyed)
            return reject(new Error("Outbound ESL disconnected"))
          const timer = setTimeout(() => {
            this.socket.destroy()
            reject(new Error("Outbound ESL command timed out"))
          }, 5000)
          this.reply = {
            resolve: (frame) => {
              clearTimeout(timer)
              resolve(frame)
            },
            reject: (error) => {
              clearTimeout(timer)
              reject(error)
            },
          }
          this.socket.write(`${text}\n\n`)
        })
    )
    this.serial = operation.catch(() => undefined)
    return operation
  }
  async connect() {
    const frame = await this.command("connect")
    this.uuid = frame.headers["Unique-ID"]
    if (
      !/^[0-9a-f-]{36}$/i.test(this.uuid) ||
      frame.headers["Socket-Mode"] !== "async" ||
      frame.headers.Control !== "full"
    )
      throw new Error("Expected socket async full")
    await this.command("myevents")
    await this.command("linger 5")
    return frame.headers
  }
  async api(text: string) {
    return (await this.command(`api ${safeLine(text)}`)).body.trim()
  }
  async execute(application: string, argument: string, timeoutMs = 65000) {
    if (!/^[a-z_]+$/.test(application)) throw new Error("Invalid application")
    safeLine(argument)
    const id = randomUUID()
    let timer: NodeJS.Timeout | undefined
    const completion = new Promise<Record<string, string>>(
      (resolve, reject) => {
        this.applications.set(id, { resolve, reject })
        timer = setTimeout(
          () => reject(new Error(`${application} timed out`)),
          timeoutMs
        )
      }
    )
    // Observe rejection even if command acknowledgement itself fails.
    void completion.catch(() => undefined)
    try {
      await this.command(
        `sendmsg ${this.uuid}\ncall-command: execute\nexecute-app-name: ${application}\nexecute-app-arg: ${argument}\nevent-lock: true\nEvent-UUID: ${id}`
      )
      return await completion
    } finally {
      clearTimeout(timer)
      this.applications.delete(id)
    }
  }
  play(prompt: string) {
    return this.execute("playback", prompt)
  }
  async playAndGetDigits(
    prompt: string,
    invalid: string,
    variable = "voice_choice"
  ) {
    if (!/^[a-z_]+$/.test(variable)) throw new Error("Invalid digit variable")
    const event = await this.execute(
      "play_and_get_digits",
      `1 1 3 5000 # ${safeLine(prompt)} ${safeLine(invalid)} ${variable} [12] 2000`
    )
    return (
      event[`variable_${variable}`] ??
      (await this.api(`uuid_getvar ${this.uuid} ${variable}`))
    )
  }
  break() {
    return this.api(`uuid_break ${this.uuid} all`)
  }
  transfer(extension: string) {
    if (!/^[a-zA-Z0-9_-]{1,256}$/.test(extension))
      throw new Error("Invalid local extension")
    return this.api(`uuid_transfer ${this.uuid} ${extension} XML calling`)
  }
  record(action: "start" | "stop") {
    return this.api(
      `uuid_record ${this.uuid} ${action} /recordings/${this.uuid}.wav`
    )
  }
  schedHangup(seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
      throw new Error("Invalid duration cap")
    return this.api(`sched_hangup +${seconds} ${this.uuid} ALLOTTED_TIMEOUT`)
  }
  close() {
    this.socket.destroy()
  }
}

export class OutboundEslServer {
  private readonly sockets = new Set<OutboundCall>()
  private readonly server = createServer((socket) => {
    const call = new OutboundCall(socket)
    this.sockets.add(call)
    call.once("close", () => this.sockets.delete(call))
    void call
      .connect()
      .then((headers) => this.accept(call, headers))
      .catch(() => call.close())
  })
  constructor(
    private readonly accept: (
      call: OutboundCall,
      headers: Record<string, string>
    ) => Promise<void>
  ) {}
  async listen(port: number, host = "0.0.0.0") {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject)
      this.server.listen(port, host, () => {
        this.server.off("error", reject)
        resolve()
      })
    })
  }
  async close() {
    for (const call of this.sockets) call.close()
    if (this.server.listening)
      await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }
}
