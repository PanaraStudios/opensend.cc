// Destructive only to the explicitly selected, disposable test deployment.
// Start `convex logs --jsonl` into OPENSEND_TEST_LOG first.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { ConvexHttpClient } from "convex/browser"
import { api } from "../convex/_generated/api.js"
if (process.env.OPENSEND_SMOKE !== "isolated-test-instance")
  throw new Error(
    "Set OPENSEND_SMOKE=isolated-test-instance; never run against real accounts"
  )
const base = process.env.OPENSEND_TEST_URL || "http://localhost:3400"
const backend = process.env.OPENSEND_TEST_BACKEND || "http://localhost:3210"
const logFile = process.env.OPENSEND_TEST_LOG
const password = "Isolated-test-password-123"
const ownerEmail = "owner@example.test"
const memberEmail = `member-${Date.now()}@example.test`
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
class Browser {
  cookies = new Map()
  async request(path, data, expected = 200) {
    const response = await fetch(
      path.startsWith("http") ? path : `${base}/api/auth${path}`,
      {
        method: data ? "POST" : "GET",
        headers: {
          Origin: base,
          "Content-Type": "application/json",
          Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
        redirect: "manual",
      }
    )
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]
      const i = pair.indexOf("=")
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1))
    }
    const body = await response.text()
    let parsed
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = body
    }
    assert.equal(
      response.status,
      expected,
      `${path.split("?")[0]}: ${body.slice(0, 500)}`
    )
    return parsed
  }
  async convex() {
    const { token } = await this.request("/convex/token")
    const client = new ConvexHttpClient(backend)
    client.setAuth(token)
    return client
  }
}
async function emailLink(to, subject, since = 0) {
  for (let i = 0; i < 80; i++) {
    const found = []
    for (const line of readFileSync(logFile, "utf8").split("\n")) {
      try {
        const event = JSON.parse(line)
        for (const log of event.logLines || [])
          for (const message of log.messages || []) {
            const mail = JSON.parse(message.replace(/^'|'$/g, ""))
            if (
              mail.event === "auth.email" &&
              mail.to === to &&
              mail.subject.toLowerCase().includes(subject) &&
              (event.timestamp || Infinity) >= since
            )
              found.push(mail.actionLink)
          }
      } catch {
        /* Partial log lines are retried. */
      }
    }
    if (found.length) return found.at(-1)
    await pause(250)
  }
  throw new Error(`No ${subject} email for ${to}`)
}
function totp(secret) {
  let bits = ""
  for (const char of secret.replace(/=+$/, ""))
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(char.toUpperCase())
      .toString(2)
      .padStart(5, "0")
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const count = Buffer.alloc(8)
  count.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const mac = createHmac("sha1", bytes).update(count).digest()
  const n = mac[19] & 15
  return ((mac.readUInt32BE(n) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0")
}
const owner = new Browser()
await owner.request("/sign-up/email", {
  name: "Test Owner",
  email: ownerEmail,
  password,
  callbackURL: `${base}/login`,
})
await owner.request("/sign-in/email", { email: ownerEmail, password }, 403)
await owner.request(await emailLink(ownerEmail, "verify"), undefined, 302)
await owner.request("/sign-in/email", { email: ownerEmail, password })
let client = await owner.convex()
const organizationId = await client.mutation(api.teams.create, {
  name: "Smoke Team",
})
assert.equal((await client.query(api.teams.snapshot)).teams.length, 1)
const stranger = new Browser()
await stranger.request(
  "/sign-up/email",
  { name: "Uninvited", email: "uninvited@example.test", password },
  422
)
await owner.request(
  "/organization/create",
  { name: "Bypass", slug: "bypass" },
  403
)
await client.mutation(api.teams.invite, {
  organizationId,
  email: memberEmail,
  role: "member",
})
const invitationLink = await emailLink(memberEmail, "join")
const invitationId = new URL(invitationLink).searchParams.get("id")
const member = new Browser()
await member.request("/sign-up/email", {
  name: "Test Member",
  email: memberEmail,
  password,
  callbackURL: `${base}/login`,
})
await member.request(await emailLink(memberEmail, "verify"), undefined, 302)
await member.request("/sign-in/email", { email: memberEmail, password })
let memberClient = await member.convex()
await memberClient.mutation(api.teams.respond, { invitationId, accept: true })
await assert.rejects(
  memberClient.mutation(api.teams.rename, {
    organizationId,
    name: "Escalation",
  })
)
await assert.rejects(client.mutation(api.teams.deleteAccount, {}))
console.log(
  "PASS verification, invitation-only registration, invitation acceptance, role checks, direct organization endpoint, last-admin deletion"
)
const mfa = await member.request("/two-factor/enable", { password })
const secret = new URL(mfa.totpURI).searchParams.get("secret")
await member.request("/two-factor/verify-totp", { code: totp(secret) })
await member.request("/sign-out", {})
assert.equal(await memberClient.query(api.teams.snapshot), null)
assert.equal(
  (await member.request("/sign-in/email", { email: memberEmail, password }))
    .twoFactorRedirect,
  true
)
await member.request("/two-factor/verify-totp", { code: "000000" }, 401)
await member.request("/two-factor/verify-backup-code", {
  code: mfa.backupCodes[0],
})
const regenerated = await member.request("/two-factor/generate-backup-codes", {
  password,
})
assert.ok(regenerated.backupCodes.length)
await member.request("/two-factor/disable", { password: "wrong-password" }, 400)
await member.request("/two-factor/disable", { password })
console.log(
  "PASS MFA enrollment, OTP rejection, backup-code login, regeneration, password-confirmed disable, revoked JWT"
)
memberClient = await member.convex()
await member.request("/request-password-reset", {
  email: memberEmail,
  redirectTo: `${base}/reset-password`,
})
const reset = await emailLink(memberEmail, "reset")
// Better Auth reset link redirects to the application's form with a token.
const resetResponse = await fetch(reset, { redirect: "manual" })
const resetUrl = new URL(resetResponse.headers.get("location"))
await member.request("/reset-password", {
  token: resetUrl.searchParams.get("token"),
  newPassword: password + "-changed",
})
assert.equal(await memberClient.query(api.teams.snapshot), null)
await member.request("/sign-in/email", {
  email: memberEmail,
  password: password + "-changed",
})
const nextEmail = memberEmail.replace("member-", "changed-")
await member.request("/change-email", {
  newEmail: nextEmail,
  callbackURL: `${base}/profile`,
})
await member.request(await emailLink(memberEmail, "confirm"), undefined, 302)
await member.request(await emailLink(nextEmail, "verify"), undefined, 302)
assert.equal((await member.request("/get-session")).user.email, nextEmail)
console.log("PASS password reset, session revocation, verified email change")
client = await owner.convex()
await client.mutation(api.teams.rename, {
  organizationId,
  name: "Renamed Smoke Team",
  slug: "smoke-team-renamed",
})
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4RkAAAAASUVORK5CYII=",
  "base64"
)
await client.action(api.teams.uploadAvatar, {
  organizationId,
  bytes: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  contentType: "image/png",
})
assert.ok((await client.query(api.teams.snapshot)).teams[0].avatar)
await client.mutation(api.teams.removeAvatar, { organizationId })
memberClient = await member.convex()
await memberClient.mutation(api.teams.deleteAccount, {})
assert.equal(await memberClient.query(api.teams.snapshot), null)
console.log("PASS team rename, avatar upload/removal, account deletion")
console.log(`SMOKE_COMPLETE organizationId=${organizationId}`)
