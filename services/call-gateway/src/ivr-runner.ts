import { CallGatewayClient } from "./client.js"
import type { IvrDecision } from "./ivr-contracts.js"
import type { OutboundCall } from "./outbound-esl.js"
export class IvrBackend extends CallGatewayClient {
  start(callId: string, ivrId: string, signal: AbortSignal) {
    return this.post<IvrDecision>(
      "/calling/gateway/ivr/start",
      { callId, ivrId },
      signal
    )
  }
  next(
    callId: string,
    ivrId: string,
    menuId: string,
    digits: string,
    step: number,
    signal: AbortSignal
  ) {
    return this.post<IvrDecision>(
      "/calling/gateway/ivr/next",
      { callId, ivrId, menuId, digits, step },
      signal
    )
  }
}
export type IvrSocket = Pick<OutboundCall, "api" | "execute" | "play" | "uuid">
/** Backend URLs only, quoted as one ESL token; reject every command metacharacter. */
export function cachedPrompt(url: string) {
  if (typeof url !== "string" || url.length > 4096 || /[\s'"\\\0]/.test(url))
    throw new Error("Invalid IVR prompt URL")
  const u = new URL(url)
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new Error("Invalid IVR prompt URL")
  return `http_cache://${url}`
}
function validateDecision(d: IvrDecision) {
  if (
    !d ||
    !Number.isSafeInteger(d.step) ||
    d.step < 0 ||
    typeof d.organizationId !== "string" ||
    !/^[a-zA-Z0-9._:-]{1,256}$/.test(d.organizationId) ||
    !d.action ||
    ![
      "submenu",
      "agents",
      "bot",
      "voicemail",
      "playAndHangup",
      "hangup",
    ].includes(d.action.kind)
  )
    throw new Error("Invalid IVR decision")
  if (d.action.kind === "agents" && !/^20\d{2}$/.test(d.extension ?? ""))
    throw new Error("Invalid IVR agent")
  if (
    d.action.kind === "bot" &&
    !/^[a-zA-Z0-9._:-]{1,256}$/.test(d.action.botId)
  )
    throw new Error("Invalid IVR bot")
}
export function digitArguments(menu: NonNullable<IvrDecision["menu"]>) {
  if (
    !menu ||
    !/^[a-zA-Z0-9._:-]{1,128}$/.test(menu.id) ||
    !Number.isInteger(menu.timeoutSeconds) ||
    menu.timeoutSeconds < 1 ||
    menu.timeoutSeconds > 30 ||
    !Number.isInteger(menu.retries) ||
    menu.retries < 0 ||
    menu.retries > 5 ||
    !Number.isInteger(menu.maxDigits) ||
    menu.maxDigits < 1 ||
    menu.maxDigits > 12 ||
    !Array.isArray(menu.digits) ||
    menu.digits.length > 12 ||
    new Set(menu.digits).size !== menu.digits.length ||
    menu.digits.some((d) => !/^[0-9*#]$/.test(d))
  )
    throw new Error("Invalid IVR menu")
  // No terminator: # and * are selectable keys. Retries counts retries after the first attempt.
  const regexp = menu.digits.length
    ? `^[${menu.digits.join("")}]{1,${menu.maxDigits}}$`
    : "(?!)"
  return `1 ${menu.maxDigits} ${menu.retries + 1} ${menu.timeoutSeconds * 1000} none '${cachedPrompt(menu.promptUrl)}' '${menu.invalidUrl ? cachedPrompt(menu.invalidUrl) : "silence_stream://250"}' ivr_digits ${regexp} ${menu.timeoutSeconds * 1000}`
}
export class IvrRunner {
  constructor(private readonly backend: Pick<IvrBackend, "start" | "next">) {}
  async run(options: {
    callId: string
    ivrId: string
    socket: IvrSocket
    signal: AbortSignal
    handoff: (decision: IvrDecision) => Promise<void>
  }) {
    const { callId, ivrId, socket, signal, handoff } = options
    const requestSignal = () =>
      AbortSignal.any([signal, AbortSignal.timeout(10000)])
    let d = await this.backend.start(callId, ivrId, requestSignal())
    let prefetch = true
    for (let i = 0; i <= 100; i++) {
      if (signal.aborted) return
      validateDecision(d)
      if (d.action.kind !== "submenu") {
        await handoff(d)
        return
      }
      if (i === 100) throw new Error("IVR exceeded 100 steps")
      const m = d.menu
      if (!m || m.id !== d.action.menuId) throw new Error("Missing IVR menu")
      const args = digitArguments(m)
      if (prefetch) {
        // http_prefetch is an API command, not a dialplan application.
        await socket.api(`http_prefetch ${m.promptUrl}`)
        if (m.invalidUrl) await socket.api(`http_prefetch ${m.invalidUrl}`)
        prefetch = false
      }
      // FreeSWITCH leaves old channel variables intact when a later attempt times out.
      await socket.api(`uuid_setvar ${socket.uuid} ivr_digits`)
      await socket.api(`uuid_setvar ${socket.uuid} ivr_digits_invalid`)
      const event = await socket.execute(
        "play_and_get_digits",
        args,
        (m.retries + 1) * (m.timeoutSeconds * 2000 + 120000) + 5000
      )
      if (signal.aborted) return
      const get = async (name: string) =>
        event[`variable_${name}`] ??
        (await socket.api(`uuid_getvar ${socket.uuid} ${name}`))
      const valid = await get("ivr_digits"),
        invalid = await get("ivr_digits_invalid")
      const clean = (v: string) => (v === "_undef_" || v === "-ERR" ? "" : v)
      const digits = clean(valid)
        ? /^[0-9*#]{1,12}$/.test(valid) && m.digits.includes(valid)
          ? valid
          : "invalid"
        : clean(invalid)
          ? "invalid"
          : "timeout"
      d = await this.backend.next(
        callId,
        ivrId,
        m.id,
        digits,
        d.step,
        requestSignal()
      )
    }
    throw new Error("IVR exceeded 100 steps")
  }
}
