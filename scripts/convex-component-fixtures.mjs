import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { syntheticSesConnection } from "../tests/e2e/ses-fixture-data.mjs"

/** Test-only modules written into a disposable deployment, never the product
 * checkout. Reuse the existing SES claim/record and SNS projection boundaries.
 * The only transport exception is the exact HTTP route owned by this run.
 */
export function writeComponentFixtures(directory, { project, endpoint }) {
  if (!project.startsWith("opensend-e2e-component-"))
    throw new Error("Refusing non-test fixture deployment")
  const allowedEndpoint = new URL(endpoint)
  if (
    allowedEndpoint.hostname !== "host.docker.internal" ||
    allowedEndpoint.protocol !== "http:" ||
    allowedEndpoint.pathname !== "/opensend/webhook"
  )
    throw new Error(
      "Fixture endpoint must be the isolated example's HTTP route"
    )
  writeFileSync(
    resolve(directory, "convex/componentFixture.ts"),
    `
import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { insertRow } from "./counts"
import { insertKey } from "./apiKeys"
import { tokenHash } from "../lib/oauth/policy"
import { tokenParts } from "../lib/dashboard/ids"
import { encryptSecret } from "./secrets"
import { insertWebhook } from "./webhooks"
import { POLICY_REVISION, teamTenantName } from "./ses/contracts"

export const seed = internalMutation({
  args: { apiKey: v.string(), webhookSecret: v.string() },
  handler: async (ctx, args) => {
    const team = ${JSON.stringify(project)}
    const existing = await ctx.db.query("installation").withIndex("by_key", q => q.eq("key", "installation")).unique()
    const changes = { ...${JSON.stringify(syntheticSesConnection)}, policyRevision: POLICY_REVISION, completedAt: Date.now(), channels: { email: true, meta: false } } as const
    const installation = existing?._id ?? await ctx.db.insert("installation", {
      key: "installation", siteUrl: "http://localhost", callbackOrigin: "https://callback.opensend.test", environmentCheckedAt: Date.now(), ...changes,
    })
    if (existing) await ctx.db.patch("installation", installation, changes)
    const topicArn = "arn:aws:sns:us-east-1:123456789012:component-fixture"
    await ctx.db.insert("sesRegions", {
      region: "us-east-1", phase: "ready", checkedAt: Date.now(), callbackConfirmed: true, topicArn,
      quota: { production: true, sendingEnabled: true, daily: 200, rate: 10, sent: 0 },
    })
    const tenantName = teamTenantName(installation, team)
    const tenant = await ctx.db.insert("sesTenants", {
      organizationId: team, region: "us-east-1", name: tenantName, phase: "ready", operation: "provision", generation: 1, deleted: false,
      arn: "arn:aws:ses:us-east-1:123456789012:tenant/" + tenantName + "/fixture-tenant", providerId: "fixture-tenant", sendingStatus: "ENABLED",
    })
    // Same verified-domain fields as seedBroadcastSender in browser e2e.
    await insertRow(ctx, "domains", {
      organizationId: team, tenantId: tenant, tenantAssociated: true, name: "mail.example.test", region: "us-east-1", customReturnPath: "send",
      status: "verified", phase: "ready", deleted: false, sending: true, tls: "opportunistic", records: [],
      sesVerified: true, dkimVerified: true, mailFromVerified: true, configurationSet: "opensend-e2e-broadcasts", operation: "provision",
    })
    const parts = tokenParts(args.apiKey)
    await insertKey(ctx, team, { name: "Component test", permission: "full_access" }, {
      tokenHash: await tokenHash(args.apiKey), tokenPrefix: parts.prefix, tokenLast4: parts.last4,
    }, { name: "Component fixture" })
    const webhookId = await insertWebhook(ctx, {
      organizationId: team, endpoint: "https://component-fixture.invalid/opensend/webhook",
      events: ["email.sent", "email.delivered", "email.bounced", "email.failed"], secret: await encryptSecret(args.webhookSecret),
    })
    await ctx.db.patch("webhooks", webhookId, { endpoint: ${JSON.stringify(endpoint)} })
    return { team, topicArn, webhookId }
  },
})
`
  )
  // Existing unit tests mock SESv2Client.send. At the real deployed backend we
  // substitute only that provider outcome, using the production claim + record.
  const sendFile = resolve(directory, "convex/emailSend.ts")
  const originalSend = readFileSync(sendFile, "utf8")
  const start = originalSend.indexOf("export const deliver = internalAction({")
  const end = originalSend.indexOf("/** Clears a removed bounce")
  if (start < 0 || end < start)
    throw new Error("SES sender changed; update the fixture seam")
  const deliver = `export const deliver = internalAction({
  args: { id: v.id("emails"), generation: v.number() }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const message = await ctx.runMutation(internal.emails.claim, args)
    if (message) await ctx.runMutation(internal.emails.record, {
      ...args, outcome: { kind: "sent", messageId: "ses-" + args.id },
    })
    return null
  },
})

`
  writeFileSync(
    sendFile,
    originalSend.slice(0, start) + deliver + originalSend.slice(end)
  )
  const file = resolve(directory, "convex/webhookDelivery.ts")
  let source = readFileSync(file, "utf8")
  const validation = "const problem = webhookEndpointError(target.endpoint)"
  const transport = "const response = await publicFetch(url, {"
  if (!source.includes(validation) || !source.includes(transport))
    throw new Error("Webhook transport changed; update the fixture seam")
  source = source.replace(
    validation,
    `const problem = target.endpoint === ${JSON.stringify(endpoint)} ? null : webhookEndpointError(target.endpoint)`
  )
  source = source.replace(
    transport,
    `${transport}\n    localOrigin: target.endpoint === ${JSON.stringify(endpoint)} ? new URL(target.endpoint).origin : undefined,`
  )
  writeFileSync(file, source)
}
