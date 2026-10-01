import { randomBytes, timingSafeEqual } from "node:crypto"
import { GatewayError } from "./errors.js"

export interface AgentCredential {
  extension: string
  password: string
  expiresAt: number
}
/** Short-lived passwords exist only in controller memory. Never reuse a slot while
 * an old 120-second SIP registration might still exist. */
export class AgentSessions {
  private readonly sessions = new Map<string, AgentCredential>()
  private readonly quarantine = new Map<string, number>()
  constructor(private readonly now = Date.now) {}
  private sweep() {
    for (const [id, row] of this.sessions)
      if (row.expiresAt <= this.now()) this.revoke(id)
  }
  issue(id: string): AgentCredential {
    this.sweep()
    const existing = this.sessions.get(id)
    if (existing) {
      existing.expiresAt = this.now() + 120000
      return { ...existing }
    }
    const used = new Set([...this.sessions.values()].map((s) => s.extension))
    const extension = Array.from({ length: 100 }, (_, i) =>
      String(2000 + i)
    ).find((e) => !used.has(e) && (this.quarantine.get(e) ?? 0) <= this.now())
    if (!extension)
      throw new GatewayError(
        "AGENT_CAPACITY",
        "All browser agent slots are busy",
        503
      )
    const row = {
      extension,
      password: randomBytes(32).toString("hex"),
      expiresAt: this.now() + 120000,
    }
    this.sessions.set(id, row)
    return { ...row }
  }
  revoke(id: string) {
    const row = this.sessions.get(id)
    if (row)
      this.quarantine.set(
        row.extension,
        Math.max(row.expiresAt, this.now()) + 150000
      )
    this.sessions.delete(id)
  }
  active(extension: string) {
    this.sweep()
    return [...this.sessions.values()].some((s) => s.extension === extension)
  }
  directory(extension: string, sipSecret: string) {
    this.sweep()
    const session = [...this.sessions.values()].find(
      (s) => s.extension === extension
    )
    const password = /^10\d{2}$/.test(extension) ? sipSecret : session?.password
    if (!password)
      return '<document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>'
    // Every interpolated value is constrained to digits/hex. Empty context denies
    // browser-originated INVITEs; all bridges are authorized by the backend.
    const dialString =
      "{presence_id=${dialed_user}@${dialed_domain}}${sofia_contact(${dialed_user}@${dialed_domain})}"
    return `<document type="freeswitch/xml"><section name="directory"><domain name="freeswitch"><params><param name="dial-string" value="${dialString}"/></params><groups><group name="calling"><users><user id="${extension}"><params><param name="password" value="${password}"/></params><variables><variable name="user_context" value="${session ? "softphone-deny" : "calling"}"/><variable name="absolute_codec_string" value="OPUS@48000h@20i"/></variables></user></users></group></groups></domain></section></document>`
  }
}
export function directoryAuthorized(
  header: string | undefined,
  secret: string
) {
  if (!secret) return false
  const actual = Buffer.from(header ?? "")
  const expected = Buffer.from(
    `Basic ${Buffer.from(`directory:${secret}`).toString("base64")}`
  )
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
