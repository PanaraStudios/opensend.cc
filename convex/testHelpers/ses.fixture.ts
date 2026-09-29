import workpoolTest from "@convex-dev/workpool/test"
/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import workflowTest from "@convex-dev/workflow/test"
import rateLimiterTest from "@convex-dev/rate-limiter/test"
import aggregateTest from "@convex-dev/aggregate/test"
import migrationsTest from "@convex-dev/migrations/test"
import { POLICY_REVISION, teamTenantName } from "../ses/contracts"
import { insertRow } from "../counts"
import { encryptCredentials } from "../ses/crypto"
import schema from "../schema"
import authSchema from "../betterAuth/schema"
import { components, internal } from "../_generated/api"

const modules = import.meta.glob("../**/*.ts")
/** The aggregates convex.config.ts mounts for convex/counts.ts. */
const COUNT_COMPONENTS = [
  "receivedEmailCounts",
  "broadcastEventCounts",
  "broadcastHistoryCounts",
  "broadcastRecipientCounts",
  "broadcastCounts",
  "reputationCounts",
  "domainMetricCounts",
  "emailMetricCounts",
  "emailDomainCounts",
  "automationCounts",
  "automationRunCounts",
  "automationStepCounts",
  "contactImportCounts",
  "contactCounts",
  "segmentCounts",
  "segmentMemberCounts",
  "topicCounts",
  "propertyCounts",
  "templateCounts",
  "apiKeyCounts",
  "apiLogCounts",
  "apiKeyLogCounts",
  "webhookCounts",
  "deliveryCounts",
  "domainCounts",
  "exportCounts",
  "emailCounts",
  "suppressionCounts",
  "emailRecipientCounts",
  "emailEventCounts",
]
const authModules = import.meta.glob("../betterAuth/**/*.ts")
/** A connected us-east-1 installation on the current IAM policy revision: the
    bootstrap admin ("owner") with a ready tenant and one domain, and a second
    user ("outsider") with a team of their own. */
export async function fixture() {
  const t = convexTest(schema, modules)
  t.registerComponent("betterAuth", authSchema, authModules)
  workpoolTest.register(t, "inboundPool")
  workflowTest.register(t)
  rateLimiterTest.register(t)
  for (const name of COUNT_COMPONENTS) aggregateTest.register(t, name)
  migrationsTest.register(t)
  async function actor(name: string, bootstrap = false) {
    const user = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name,
          email: `${name}@example.test`,
          emailVerified: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: user._id,
          token: name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        },
      },
    })
    if (bootstrap)
      await t.mutation(components.betterAuth.policy.admitUser, {
        userId: user._id,
        email: user.email,
      })
    const client = t.withIdentity({ subject: user._id, sessionId: session._id })
    const team = await t.mutation(components.betterAuth.teams.create, {
      name,
      sessionId: session._id,
    })
    return { client, team, user, session }
  }
  const owner = await actor("owner", true)
  const outsider = await actor("outsider")
  const installation = await owner.client.mutation(
    internal.installation.saveEnvironment,
    {
      siteUrl: "https://opensend.test",
      callbackOrigin: "https://api.opensend.test",
    }
  )
  await owner.client.mutation(internal.installation.activateConnection, {
    revision: 0,
    accountId: "123456789012",
    credentialKind: "keys",
    encryptedCredentials: "ciphertext",
    accessKeyLast4: "1234",
    defaultRegion: "us-east-1",
    regions: [
      {
        region: "us-east-1",
        quota: {
          production: false,
          sendingEnabled: true,
          daily: 200,
          rate: 1,
          sent: 0,
        },
      },
    ],
  })
  const region = await t.run(
    async (ctx) => (await ctx.db.query("sesRegions").first())!
  )
  await t.mutation(internal.ses.state.patchRegion, {
    id: region._id,
    changes: {
      phase: "ready",
      topicArn: "arn:aws:sns:us-east-1:123456789012:opensend-events",
    },
  })
  const tenantName = teamTenantName(installation, owner.team)
  const tenant = await t.run((ctx) =>
    ctx.db.insert("sesTenants", {
      organizationId: owner.team,
      region: "us-east-1",
      name: tenantName,
      phase: "ready",
      operation: "provision",
      generation: 1,
      deleted: false,
      arn: `arn:aws:ses:us-east-1:123456789012:tenant/${tenantName}/provider-tenant`,
      providerId: "provider-tenant",
      sendingStatus: "ENABLED",
    })
  )
  const domain = await t.run((ctx) =>
    insertRow(ctx, "domains", {
      organizationId: owner.team,
      tenantId: tenant,
      tenantAssociated: false,
      name: "mail.example.test",
      region: "us-east-1",
      customReturnPath: "send",
      status: "pending",
      phase: "ready",
      deleted: false,
      sending: true,
      tls: "opportunistic",
      records: [],
      sesVerified: false,
      dkimVerified: false,
      mailFromVerified: false,
      operation: "provision",
    })
  )
  await t.run((ctx) =>
    ctx.db.patch("installation", installation, {
      completedAt: Date.now(),
      policyRevision: POLICY_REVISION,
    })
  )
  return {
    t,
    owner,
    outsider,
    installation,
    region,
    domain,
    actor,
    tenant,
    tenantName,
  }
}
/** Stores decryptable access keys, so actions can build AWS clients. */
export const storeTestCredentials = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.t.run((ctx) =>
    ctx.db.patch("installation", f.installation, {
      encryptedCredentials: encryptCredentials(
        {
          kind: "keys",
          accessKeyId: "AKIAFIXTURE1234567890",
          secretAccessKey: "test-only-secret",
        },
        f.installation
      ),
    })
  )
