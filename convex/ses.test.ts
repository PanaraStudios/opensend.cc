/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { convexTest } from "convex-test"
import workflowTest from "@convex-dev/workflow/test"
import rateLimiterTest from "@convex-dev/rate-limiter/test"
import { teamTenantName } from "./ses/contracts"
import schema from "./schema"
import authSchema from "./betterAuth/schema"
import { api, components, internal } from "./_generated/api"
import {
  encryptCredentials,
  decryptCredentials,
  createWrappedKey,
} from "./ses/crypto"
import {
  identityRecords,
  checkRecords,
  detectDnsProvider,
  providerFromNameservers,
} from "./ses/dns"
import { assertOwned, mergePolicy, awsError } from "./ses/aws"
import { installationUrl } from "./ses/contracts"
import {
  certificateUrl,
  parseSns,
  stringToSign,
  limitedBody,
  verifySignature,
} from "./ses/sns"
import {
  SESv2Client,
  type GetEmailIdentityResponse,
  type Tenant,
} from "@aws-sdk/client-sesv2"
import { Resolver } from "node:dns/promises"

const modules = import.meta.glob("./**/*.ts")
const authModules = import.meta.glob("./betterAuth/**/*.ts")
async function fixture() {
  const t = convexTest(schema, modules)
  t.registerComponent("betterAuth", authSchema, authModules)
  workflowTest.register(t)
  rateLimiterTest.register(t)
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
    ctx.db.insert("domains", {
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
  await t.run((ctx) => ctx.db.patch(installation, { completedAt: Date.now() }))
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

beforeEach(() => vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32)))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("installation and domain authorization", () => {
  test("bootstrap administrator differs from team administrator; ciphertext never leaves the status query", async () => {
    const f = await fixture()
    expect((await f.owner.client.query(api.installation.status)).admin).toBe(
      true
    )
    const status = await f.outsider.client.query(api.installation.status)
    expect(status.admin).toBe(false)
    expect(JSON.stringify(status)).not.toContain("ciphertext")
    await expect(
      f.outsider.client.mutation(api.installation.provisionRegion, {
        region: "us-east-1",
      })
    ).rejects.toThrow("installation administrator")
    await expect(f.t.query(api.installation.status)).rejects.toThrow("Sign in")
  })
  test("cross-team reads and writes are denied using live membership", async () => {
    const f = await fixture()
    await expect(
      f.outsider.client.query(api.domains.get, { id: f.domain })
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.mutation(api.domains.update, {
        id: f.domain,
        sending: false,
      })
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.query(api.domains.list, {
        organizationId: f.owner.team,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).rejects.toThrow("permission")
    const invite = await f.owner.client.mutation(api.teams.invite, {
      organizationId: f.owner.team,
      email: f.outsider.user.email,
      role: "member",
    })
    void invite
    const invitations = await f.outsider.client.query(api.teams.snapshot)
    await f.outsider.client.mutation(api.teams.respond, {
      invitationId: invitations!.receivedInvitations[0].id,
      accept: true,
    })
    expect(
      await f.outsider.client.query(api.domains.get, { id: f.domain })
    ).not.toBeNull()
    await expect(
      f.outsider.client.mutation(api.domains.update, {
        id: f.domain,
        sending: false,
      })
    ).rejects.toThrow("permission")
  })
  test("revoked sessions cannot read installation or change a domain", async () => {
    const f = await fixture()
    await f.t.mutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: "session",
        where: [{ field: "_id", value: f.owner.session._id }],
      },
    })
    await expect(f.owner.client.query(api.installation.status)).rejects.toThrow(
      "Sign in"
    )
    await expect(
      f.owner.client.mutation(api.domains.update, {
        id: f.domain,
        sending: false,
      })
    ).rejects.toThrow("Sign in")
  })
  test("rotations are compare-and-swap, preserve account and all enabled regions", async () => {
    const f = await fixture()
    const input = {
      revision: 1,
      accountId: "123456789012",
      credentialKind: "role" as const,
      defaultRegion: "us-east-1" as const,
      regions: [{ region: "us-east-1" as const, quota: f.region.quota }],
    }
    await expect(
      f.owner.client.mutation(internal.installation.activateConnection, {
        ...input,
        accountId: "999999999999",
      })
    ).rejects.toThrow("one AWS account")
    await f.owner.client.mutation(
      internal.installation.activateConnection,
      input
    )
    await expect(
      f.owner.client.mutation(internal.installation.activateConnection, input)
    ).rejects.toThrow("Setup changed")
    expect(
      (await f.t.query(internal.installation.connection)).encryptedCredentials
    ).toBeUndefined()
  })
  test("indexed pagination filters by team, prefix, status and region", async () => {
    const f = await fixture()
    const result = await f.owner.client.query(api.domains.list, {
      organizationId: f.owner.team,
      search: "MAIL.",
      status: "pending",
      region: "us-east-1",
      paginationOpts: { cursor: null, numItems: 1 },
    })
    expect(result.page.map((d) => d._id)).toEqual([f.domain])
    expect(
      (
        await f.owner.client.query(api.domains.list, {
          organizationId: f.owner.team,
          search: "other",
          paginationOpts: { cursor: null, numItems: 10 },
        })
      ).page
    ).toEqual([])
  })
  test("invalid names, duplicate identities and unconfigured regions never enqueue work", async () => {
    const f = await fixture()
    const input = {
      organizationId: f.owner.team,
      name: "mail.example.test",
      region: "us-east-1" as const,
      customReturnPath: "send",
    }
    await expect(
      f.owner.client.mutation(api.domains.create, input)
    ).rejects.toThrow("reserved")
    await expect(
      f.owner.client.mutation(api.domains.create, {
        ...input,
        name: "https://bad.test/path",
      })
    ).rejects.toThrow("valid domain")
    await expect(
      f.owner.client.mutation(api.domains.create, {
        ...input,
        name: "new.test",
        region: "eu-west-1",
      })
    ).rejects.toThrow("Provision")
    await expect(
      f.owner.client.mutation(api.domains.create, {
        ...input,
        customReturnPath: "a.b",
      })
    ).rejects.toThrow("one label")
  })
  test("removal disables sending atomically and retains a tombstone", async () => {
    vi.useFakeTimers()
    const f = await awsFixture()
    await f.owner.client.mutation(api.domains.remove, { id: f.domain })
    expect(
      (await f.owner.client.query(api.domains.get, { id: f.domain }))?.domain
    ).toMatchObject({ sending: false, phase: "running" })
    await expect(
      f.owner.client.mutation(api.domains.refresh, { id: f.domain })
    ).rejects.toThrow("already running")
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    expect(
      await f.owner.client.query(api.domains.get, { id: f.domain })
    ).toBeNull()
    expect(await f.t.run((ctx) => ctx.db.get(f.domain))).not.toBeNull()
  })
  test("SNS ingestion deduplicates events and refuses unknown topics", async () => {
    const f = await fixture()
    const event = {
      topicArn: "arn:aws:sns:us-east-1:123456789012:opensend-events",
      messageId: "id",
      message: "{}",
    }
    await f.t.mutation(internal.ses.state.ingest, event)
    await f.t.mutation(internal.ses.state.ingest, event)
    expect(
      await f.t.run((ctx) => ctx.db.query("sesEvents").collect())
    ).toHaveLength(1)
    await expect(
      f.t.mutation(internal.ses.state.ingest, { ...event, topicArn: "unknown" })
    ).rejects.toThrow("Unknown")
  })
})

describe("AWS boundary regression scenarios", () => {
  test("SNS authorization errors identify the failed operation without exposing provider details", () => {
    const error = Object.assign(new Error("private provider request details"), {
      name: "AuthorizationErrorException",
      opensendOperation: "GetTopicAttributesCommand",
    })
    expect(awsError(error)).toBe(
      "GetTopicAttributes: AWS denied this operation. Check the installation IAM policy and the selected region."
    )
    expect(awsError(error)).not.toContain("private")
    error.name = "InternalErrorException"
    expect(awsError(error)).toContain(
      "GetTopicAttributes: AWS operation failed (InternalErrorException)"
    )
    error.opensendOperation = "private provider request details"
    expect(awsError(error)).not.toContain("private")
  })
  test("credentials are encrypted, installation-bound, and reject tampering and wrong keys", () => {
    const credentials = {
      kind: "keys" as const,
      accessKeyId: "AKIATEST",
      secretAccessKey: "never-show-me",
      sessionToken: "session",
    }
    const encrypted = encryptCredentials(credentials, "installation-a")
    expect(encrypted).not.toContain(credentials.secretAccessKey)
    expect(decryptCredentials(encrypted, "installation-a")).toEqual(credentials)
    expect(() => decryptCredentials(encrypted, "installation-b")).toThrow()
    vi.stubEnv("SES_ENCRYPTION_KEY", "cd".repeat(32))
    expect(() => decryptCredentials(encrypted, "installation-a")).toThrow()
    vi.stubEnv("SES_ENCRYPTION_KEY", "invalid")
    expect(() => encryptCredentials(credentials, "installation-a")).toThrow(
      "previous installation"
    )
  })
  test("DNS comes from AWS tokens and hosted zone; no guessed DKIM suffix", () => {
    const records = identityRecords("example.test", "eu-west-1", "send", {
      DkimAttributes: {
        Tokens: ["aws-token"],
        SigningHostedZone: "regional.dkim.amazonses.com",
      },
    })
    expect(records[0]).toMatchObject({
      name: "aws-token._domainkey.example.test",
      value: "aws-token.regional.dkim.amazonses.com",
    })
    expect(() =>
      identityRecords("example.test", "eu-west-1", "send", {})
    ).toThrow("hosted zone")
  })
  test("DNS compares answers, joins TXT chunks, and distinguishes missing from temporary failures", async () => {
    const records = identityRecords("example.test", "us-east-1", "send", {
      DkimAttributes: {
        Tokens: ["token"],
        SigningHostedZone: "dkim.amazonses.com",
      },
    })
    const resolver = {
      resolveCname: async () => ["token.dkim.amazonses.com."],
      resolveMx: async () => [
        { exchange: "feedback-smtp.us-east-1.amazonses.com.", priority: 10 },
      ],
      resolveTxt: async () => [["v=spf1 ", "include:amazonses.com ~all"]],
    } as unknown as Resolver
    expect(
      (await checkRecords(records, resolver)).every(
        (r) => r.status === "verified"
      )
    ).toBe(true)
    resolver.resolveCname = async () => {
      throw Object.assign(new Error(), { code: "ENOTFOUND" })
    }
    resolver.resolveMx = async () => {
      throw Object.assign(new Error(), { code: "ETIMEOUT" })
    }
    const result = await checkRecords(records, resolver)
    expect(result[0].status).toBe("pending")
    expect(result[1].status).toBe("temporary_failure")
  })
  test("policy merges preserve unrelated AWS grants and refuse unowned resources", () => {
    const grant = { Sid: "Opensend", Effect: "Allow" }
    const result = JSON.parse(
      mergePolicy(
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [{ Sid: "Other" }, { Sid: "Opensend", stale: true }],
        }),
        grant
      )
    )
    expect(result.Statement).toEqual([{ Sid: "Other" }, grant])
    expect(() => assertOwned([], "installation")).toThrow("not owned")
    expect(() =>
      assertOwned(
        [{ Key: "opensend:installation", Value: "installation" }],
        "installation",
        "domain"
      )
    ).toThrow("not owned")
  })
  test("callback URLs and certificate hosts cannot supply arbitrary fetch targets", async () => {
    expect(() => installationUrl("https://user:secret@example.com")).toThrow()
    expect(() => installationUrl("http://example.com")).toThrow()
    expect(() => installationUrl("https://127.0.0.1")).toThrow()
    expect(() => parseSns('{"Type":"Notification"}')).toThrow()
    const message = parseSns(
      JSON.stringify({
        Type: "Notification",
        TopicArn: "arn:aws:sns:us-east-1:123456789012:test",
        Message: "hello",
        MessageId: "id",
        Timestamp: new Date().toISOString(),
        SignatureVersion: "2",
        Signature: "x",
        SigningCertURL:
          "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
      })
    )
    expect(certificateUrl(message)).toContain("sns.us-east-1.amazonaws.com")
    expect(stringToSign(message)).toContain("Message\nhello\nMessageId\nid\n")
    expect(() =>
      certificateUrl({
        ...message,
        SigningCertURL: "https://evil.test/cert.pem",
      })
    ).toThrow()
    await expect(limitedBody(new Response("too large"), 2)).rejects.toThrow(
      "too large"
    )
  })
})

async function awsFixture() {
  const f = await fixture()
  await f.t.run((ctx) =>
    ctx.db.patch(f.installation, {
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
  const tags = [
    { Key: "opensend:installation", Value: f.installation },
    { Key: "opensend:domain", Value: f.domain },
  ]
  const providerTenants = new Map<string, Tenant>([
    [
      f.tenantName,
      {
        TenantName: f.tenantName,
        TenantId: "provider-tenant",
        TenantArn: `arn:aws:ses:us-east-1:123456789012:tenant/${f.tenantName}/provider-tenant`,
        Tags: [
          { Key: "opensend:installation", Value: f.installation },
          { Key: "opensend:team", Value: f.owner.team },
        ],
        SendingStatus: "ENABLED",
        SuppressionAttributes: {
          SuppressionScope: "TENANT",
          SuppressedReasons: ["BOUNCE", "COMPLAINT"],
        },
      },
    ],
  ])
  const associations = new Map<string, Set<string>>()
  const state = {
    tenants: providerTenants,
    associations,
    failAssociation: false,
    denyMissingTenantLookup: false,
    identity: null as GetEmailIdentityResponse | null,
    config: false,
    calls: [] as string[],
    failMailFrom: false,
    failConfigurationAttach: false,
    honorCreateConfigurationSet: true,
    failTls: false,
    tlsPolicy: "OPTIONAL",
  }
  vi.spyOn(Resolver.prototype, "resolveCname").mockResolvedValue([])
  vi.spyOn(Resolver.prototype, "resolveMx").mockResolvedValue([])
  vi.spyOn(Resolver.prototype, "resolveTxt").mockResolvedValue([])
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
    async (command) => {
      const name = command.constructor.name
      const input = command.input as Record<string, unknown>
      state.calls.push(name)
      const tenantName = input.TenantName as string
      const resourceArn = input.ResourceArn as string
      if (name === "GetTenantCommand") {
        const tenant = state.tenants.get(tenantName)
        if (!tenant)
          throw Object.assign(new Error("missing"), {
            name: state.denyMissingTenantLookup
              ? "AccessDeniedException"
              : "NotFoundException",
          })
        return { Tenant: tenant } as never
      }
      if (name === "CreateTenantCommand") {
        if (state.tenants.has(tenantName))
          throw Object.assign(new Error("existing"), {
            name: "AlreadyExistsException",
          })
        state.tenants.set(tenantName, {
          TenantName: tenantName,
          TenantId: `provider-${tenantName}`,
          TenantArn: `arn:aws:ses:us-east-1:123456789012:tenant/${tenantName}/provider-id`,
          Tags: input.Tags as Tenant["Tags"],
          SendingStatus: "ENABLED",
          SuppressionAttributes:
            input.SuppressionAttributes as Tenant["SuppressionAttributes"],
        })
      }
      if (name === "PutTenantSuppressionAttributesCommand")
        state.tenants.get(tenantName)!.SuppressionAttributes = {
          SuppressionScope: input.SuppressionScope as "TENANT",
          SuppressedReasons: ["BOUNCE", "COMPLAINT"],
        }
      if (name === "ListResourceTenantsCommand")
        return {
          ResourceTenants: [...(state.associations.get(resourceArn) ?? [])].map(
            (TenantName) => ({ TenantName, ResourceArn: resourceArn })
          ),
        } as never
      if (name === "CreateTenantResourceAssociationCommand") {
        if (state.failAssociation)
          throw Object.assign(new Error(), { name: "AccessDeniedException" })
        const members = state.associations.get(resourceArn) ?? new Set<string>()
        members.add(tenantName)
        state.associations.set(resourceArn, members)
      }
      if (name === "DeleteTenantResourceAssociationCommand")
        state.associations.get(resourceArn)?.delete(tenantName)
      if (name === "ListTenantResourcesCommand")
        return {
          TenantResources: [...state.associations]
            .filter(([, members]) => members.has(tenantName))
            .map(([ResourceArn]) => ({ ResourceArn })),
        } as never
      if (name === "DeleteTenantCommand") state.tenants.delete(tenantName)
      if (name === "GetEmailIdentityCommand") {
        if (!state.identity)
          throw Object.assign(new Error("missing"), {
            name: "NotFoundException",
          })
        return state.identity as never
      }
      if (name === "GetConfigurationSetCommand") {
        if (!state.config)
          throw Object.assign(new Error("missing"), {
            name: "NotFoundException",
          })
        return {} as never
      }
      if (name === "CreateConfigurationSetCommand") state.config = true
      if (name === "PutConfigurationSetDeliveryOptionsCommand") {
        if (state.failTls)
          throw Object.assign(new Error("provider request must stay private"), {
            name: "AccessDeniedException",
          })
        state.tlsPolicy = input.TlsPolicy as string
      }
      if (name === "ListTagsForResourceCommand") return { Tags: tags } as never
      if (name === "CreateEmailIdentityCommand")
        state.identity = {
          Tags: tags,
          ConfigurationSetName: state.honorCreateConfigurationSet
            ? (input.ConfigurationSetName as string)
            : undefined,
          DkimAttributes: {
            Tokens: ["provider-token"],
            SigningHostedZone: "regional.dkim.amazonses.com",
            Status: "PENDING",
            SigningEnabled: true,
          },
        }
      if (name === "PutEmailIdentityMailFromAttributesCommand") {
        if (state.failMailFrom)
          throw Object.assign(
            new Error("request containing secret must not escape"),
            { name: "AccessDeniedException" }
          )
        if (state.identity)
          state.identity.MailFromAttributes = {
            MailFromDomain: input.MailFromDomain as string | undefined,
            BehaviorOnMxFailure: input.BehaviorOnMxFailure as "REJECT_MESSAGE",
            MailFromDomainStatus: "PENDING",
          }
      }
      if (
        name === "PutEmailIdentityConfigurationSetAttributesCommand" &&
        state.identity
      ) {
        if (state.failConfigurationAttach)
          throw Object.assign(new Error("secret provider details"), {
            name: "AccessDeniedException",
          })
        state.identity.ConfigurationSetName = input.ConfigurationSetName as
          string | undefined
      }
      if (name === "TagResourceCommand" && state.identity)
        state.identity.Tags = [...(state.identity.Tags ?? []), ...tags]
      if (name === "UntagResourceCommand" && state.identity)
        state.identity.Tags = state.identity.Tags?.filter(
          (t) => !t.Key?.startsWith("opensend:")
        )
      if (name === "DeleteEmailIdentityCommand") state.identity = null
      if (name === "DeleteConfigurationSetCommand") state.config = false
      if (name === "GetAccountCommand")
        return {
          ProductionAccessEnabled: false,
          SendingEnabled: true,
          SendQuota: { Max24HourSend: 200, MaxSendRate: 1 },
        } as never
      return {} as never
    }
  )
  return { ...f, aws: state }
}
describe("provisioning actions with a controlled AWS boundary", () => {
  test("persists exact AWS DKIM values and pending readiness without faking DNS success", async () => {
    const f = await awsFixture()
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    const result = await f.owner.client.query(api.domains.get, { id: f.domain })
    expect(result?.domain).toMatchObject({
      phase: "ready",
      status: "pending",
      sesVerified: false,
    })
    expect(result?.domain.records[0].value).toBe(
      "provider-token.regional.dkim.amazonses.com"
    )
    expect(result?.region?.quota.production).toBe(false)
  })
  test("partial provisioning resumes without duplicate resources and redacts provider details", async () => {
    const f = await awsFixture()
    f.aws.failMailFrom = true
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    const failed = await f.owner.client.query(api.domains.get, { id: f.domain })
    expect(failed?.domain.phase).toBe("failed")
    expect(failed?.domain.error).toContain("denied")
    expect(failed?.domain.error).not.toContain("secret")
    f.aws.failMailFrom = false
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    expect(
      f.aws.calls.filter((c) => c === "CreateEmailIdentityCommand")
    ).toHaveLength(1)
    expect(
      f.aws.calls.filter((c) => c === "CreateConfigurationSetCommand")
    ).toHaveLength(1)
    expect(
      (await f.owner.client.query(api.domains.get, { id: f.domain }))?.domain
        .phase
    ).toBe("ready")
  })
  test("keeps AWS-issued DNS records available when configuration attachment fails", async () => {
    const f = await awsFixture()
    f.aws.failConfigurationAttach = true
    f.aws.honorCreateConfigurationSet = false
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    const result = await f.owner.client.query(api.domains.get, { id: f.domain })
    expect(result?.domain.phase).toBe("failed")
    expect(result?.domain.records[0].value).toBe(
      "provider-token.regional.dkim.amazonses.com"
    )
    expect(result?.domain.tenantAssociated).toBe(false)
    expect(result?.domain.error).not.toContain("secret")
  })
  test("does not reassign a configuration set already applied during identity creation", async () => {
    const f = await awsFixture()
    f.aws.failConfigurationAttach = true
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    expect(f.aws.calls).not.toContain(
      "PutEmailIdentityConfigurationSetAttributesCommand"
    )
    expect(
      (await f.owner.client.query(api.domains.get, { id: f.domain }))?.domain
        .phase
    ).toBe("ready")
  })
  test("unowned existing identities are preserved until an installation administrator reviews and approves", async () => {
    const f = await awsFixture()
    f.aws.identity = {
      ConfigurationSetName: "other-app",
      Tags: [{ Key: "department", Value: "marketing" }],
      DkimAttributes: {
        Tokens: ["existing"],
        SigningHostedZone: "dkim.amazonses.com",
      },
      MailFromAttributes: {
        MailFromDomain: "old.example.test",
        MailFromDomainStatus: "SUCCESS",
        BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
      },
    }
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    expect(f.aws.calls).toEqual([
      "GetTenantCommand",
      "GetEmailIdentityCommand",
      "ListResourceTenantsCommand",
    ])
    await expect(
      f.outsider.client.action(api.ses.adoption.preview, { id: f.domain })
    ).rejects.toThrow("installation administrator")
    await f.owner.client.action(api.ses.adoption.preview, { id: f.domain })
    const domain = (await f.owner.client.query(api.domains.get, {
      id: f.domain,
    }))!.domain
    expect(domain.adoption).toMatchObject({
      approved: false,
      configurationSet: "other-app",
    })
    await f.t.run((ctx) =>
      ctx.db.patch(f.domain, {
        adoption: { ...domain.adoption!, approved: true },
      })
    )
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    expect(f.aws.calls).not.toContain("CreateEmailIdentityCommand")
    expect(f.aws.identity?.Tags).toContainEqual({
      Key: "department",
      Value: "marketing",
    })
    await f.t.run((ctx) =>
      ctx.db.patch(f.domain, { operation: "remove", sending: false })
    )
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    expect(f.aws.calls).not.toContain("DeleteEmailIdentityCommand")
    expect(f.aws.identity).toMatchObject({
      ConfigurationSetName: "other-app",
      MailFromAttributes: { MailFromDomain: "old.example.test" },
      Tags: [{ Key: "department", Value: "marketing" }],
    })
  })
  test("concurrent duplicate creation reserves only one active domain and retries remain serialized", async () => {
    vi.useFakeTimers()
    const f = await awsFixture()
    const input = {
      organizationId: f.owner.team,
      name: "another.example.test",
      region: "us-east-1" as const,
      customReturnPath: "send",
    }
    const results = await Promise.allSettled([
      f.owner.client.mutation(api.domains.create, input),
      f.owner.client.mutation(api.domains.create, input),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  })
})

import {
  SIGNED_NOTIFICATION_V1,
  SIGNED_NOTIFICATION_V2,
  SIGNED_SUBSCRIPTION_CONFIRMATION,
  TEST_CERT_PEM,
} from "./testHelpers/snsFixture"
test("verifies real RSA signatures and rejects altered SNS payloads", () => {
  for (const message of [
    SIGNED_NOTIFICATION_V1,
    SIGNED_NOTIFICATION_V2,
    SIGNED_SUBSCRIPTION_CONFIRMATION,
  ]) {
    expect(() => verifySignature(message, TEST_CERT_PEM)).not.toThrow()
    expect(() =>
      verifySignature({ ...message, Message: "forged" }, TEST_CERT_PEM)
    ).toThrow("signature")
  }
  expect(() =>
    verifySignature(
      { ...SIGNED_NOTIFICATION_V2, SignatureVersion: "3" },
      TEST_CERT_PEM
    )
  ).toThrow("Unsupported")
})

import { SNSClient } from "@aws-sdk/client-sns"
import { SQSClient } from "@aws-sdk/client-sqs"
test("regional provisioning resumes, preserves policies, and allowlists the topic before subscribing", async () => {
  const f = await awsFixture()
  const prefix = `opensend-${f.installation}`
  const topicArn = `arn:aws:sns:us-east-1:123456789012:${prefix}-events`
  let topicExists = false
  let queueExists = false
  let failQueue = true
  let createTopics = 0
  let createQueues = 0
  let subscriptions = 0
  const topicPolicies: string[] = []
  vi.spyOn(SNSClient.prototype, "send").mockImplementation(async (command) => {
    const name = command.constructor.name
    const input = command.input as Record<string, unknown>
    if (name === "GetTopicAttributesCommand") {
      if (!topicExists)
        throw Object.assign(new Error(), { name: "NotFoundException" })
      return {
        Attributes: {
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{ Sid: "Unrelated" }],
          }),
        },
      } as never
    }
    if (name === "CreateTopicCommand") {
      topicExists = true
      createTopics++
    }
    if (name === "ListTagsForResourceCommand")
      return {
        Tags: [{ Key: "opensend:installation", Value: f.installation }],
      } as never
    if (
      name === "SetTopicAttributesCommand" &&
      input.AttributeName === "Policy"
    )
      topicPolicies.push(input.AttributeValue as string)
    if (name === "SubscribeCommand") {
      expect(
        await f.t.query(internal.ses.state.topic, { arn: topicArn })
      ).not.toBeNull()
      expect(input).toMatchObject({
        Endpoint: "https://api.opensend.test/ses/events",
        Protocol: "https",
        Attributes: { RawMessageDelivery: "false" },
      })
      subscriptions++
      return { SubscriptionArn: "PendingConfirmation" } as never
    }
    return {} as never
  })
  vi.spyOn(SQSClient.prototype, "send").mockImplementation(async (command) => {
    const name = command.constructor.name
    if (failQueue)
      throw Object.assign(new Error(), { name: "AccessDeniedException" })
    if (name === "GetQueueUrlCommand") {
      if (!queueExists)
        throw Object.assign(new Error(), { name: "QueueDoesNotExist" })
      return {
        QueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test",
      } as never
    }
    if (name === "CreateQueueCommand") {
      queueExists = true
      createQueues++
      return {
        QueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/test",
      } as never
    }
    if (name === "ListQueueTagsCommand")
      return { Tags: { "opensend:installation": f.installation } } as never
    if (name === "GetQueueAttributesCommand")
      return {
        Attributes: { QueueArn: "arn:aws:sqs:us-east-1:123456789012:test" },
      } as never
    return {} as never
  })
  await f.t.action(internal.ses.provision.region, { regionId: f.region._id })
  expect(
    (await f.t.query(internal.ses.state.region, { id: f.region._id })).phase
  ).toBe("failed")
  failQueue = false
  await f.t.action(internal.ses.provision.region, { regionId: f.region._id })
  expect(createTopics).toBe(1)
  expect(createQueues).toBe(1)
  expect(subscriptions).toBe(1)
  expect(JSON.parse(topicPolicies[0]).Statement[0]).toEqual({
    Sid: "Unrelated",
  })
  expect(
    await f.t.query(internal.ses.state.region, { id: f.region._id })
  ).toMatchObject({ phase: "ready", callbackConfirmed: false, topicArn })
})

test("signed SNS notifications deduplicate and forged or foreign envelopes never enter the database", async () => {
  const f = await awsFixture()
  await f.t.mutation(internal.ses.state.patchRegion, {
    id: f.region._id,
    changes: { topicArn: SIGNED_NOTIFICATION_V2.TopicArn },
  })
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => new Response(TEST_CERT_PEM))
  await f.t.action(internal.ses.events.receive, {
    body: JSON.stringify(SIGNED_NOTIFICATION_V2),
  })
  await f.t.action(internal.ses.events.receive, {
    body: JSON.stringify(SIGNED_NOTIFICATION_V2),
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("sesEvents").collect())
  ).toHaveLength(1)
  await expect(
    f.t.action(internal.ses.events.receive, {
      body: JSON.stringify({ ...SIGNED_NOTIFICATION_V2, Message: "forged" }),
    })
  ).rejects.toThrow("signature")
  const before = fetcher.mock.calls.length
  await expect(
    f.t.action(internal.ses.events.receive, {
      body: JSON.stringify({ ...SIGNED_NOTIFICATION_V2, TopicArn: "foreign" }),
    })
  ).rejects.toThrow("Unknown")
  expect(fetcher.mock.calls).toHaveLength(before)
})

test("removing a refused identity claim preserves the unrelated AWS identity", async () => {
  const f = await awsFixture()
  f.aws.identity = {
    ConfigurationSetName: "unrelated",
    Tags: [{ Key: "owner", Value: "other" }],
  }
  await f.t.run((ctx) =>
    ctx.db.patch(f.domain, { operation: "remove", sending: false })
  )
  await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
  expect(f.aws.calls).not.toContain("DeleteEmailIdentityCommand")
  expect(f.aws.identity.ConfigurationSetName).toBe("unrelated")
  expect(
    await f.owner.client.query(api.domains.get, { id: f.domain })
  ).toBeNull()
})

import { STSClient } from "@aws-sdk/client-sts"
test("connection validation rejects the wrong account and failed rotations leave active credentials intact", async () => {
  const f = await awsFixture()
  const before = await f.t.query(internal.installation.connection)
  vi.spyOn(STSClient.prototype, "send").mockResolvedValue({
    Account: "123456789012",
    Arn: "arn:aws:iam::123456789012:user/opensend",
  } as never)
  const input = {
    expectedAccountId: "999999999999",
    defaultRegion: "us-east-1" as const,
    regions: [],
    credentials: {
      kind: "keys" as const,
      accessKeyId: "AKIAFIXTURE1234567890",
      secretAccessKey: "replacement-secret",
    },
  }
  await expect(
    f.owner.client.action(api.installationActions.connect, input)
  ).rejects.toThrow("does not match")
  expect(
    (await f.t.query(internal.installation.connection)).encryptedCredentials
  ).toBe(before.encryptedCredentials)
  await f.owner.client.action(api.installationActions.connect, {
    ...input,
    expectedAccountId: "123456789012",
  })
  const rotated = await f.t.query(internal.installation.connection)
  expect(rotated.credentialRevision).toBe(before.credentialRevision + 1)
  expect(
    decryptCredentials(rotated.encryptedCredentials!, f.installation)
  ).toEqual(input.credentials)
  vi.spyOn(STSClient.prototype, "send").mockRejectedValue(
    Object.assign(new Error("replacement-secret"), {
      name: "ExpiredTokenException",
    })
  )
  await expect(
    f.owner.client.action(api.installationActions.connect, {
      ...input,
      expectedAccountId: "123456789012",
    })
  ).rejects.toThrow("expired")
  expect(
    (await f.t.query(internal.installation.connection)).encryptedCredentials
  ).toBe(rotated.encryptedCredentials)
})

test("signed subscription confirmation sets readiness only for the configured endpoint", async () => {
  const f = await awsFixture()
  await f.t.mutation(internal.ses.state.patchRegion, {
    id: f.region._id,
    changes: { topicArn: SIGNED_SUBSCRIPTION_CONFIRMATION.TopicArn },
  })
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(TEST_CERT_PEM)
  )
  const arn = `${SIGNED_SUBSCRIPTION_CONFIRMATION.TopicArn}:subscription`
  const commands: string[] = []
  vi.spyOn(SNSClient.prototype, "send").mockImplementation(async (command) => {
    commands.push(command.constructor.name)
    if (command.constructor.name === "ConfirmSubscriptionCommand")
      return { SubscriptionArn: arn } as never
    return {
      Attributes: {
        Endpoint: "https://api.opensend.test/ses/events",
        TopicArn: SIGNED_SUBSCRIPTION_CONFIRMATION.TopicArn,
        PendingConfirmation: "false",
      },
    } as never
  })
  await f.t.action(internal.ses.events.receive, {
    body: JSON.stringify(SIGNED_SUBSCRIPTION_CONFIRMATION),
  })
  await f.t.mutation(internal.ses.state.patchRegion, {
    id: f.region._id,
    changes: { phase: "ready" },
  })
  expect(
    (await f.t.query(internal.ses.state.region, { id: f.region._id }))
      .callbackConfirmed
  ).toBe(true)
  expect(commands).toEqual([
    "ConfirmSubscriptionCommand",
    "GetSubscriptionAttributesCommand",
  ])
})

test("team deletion, last-member departure and administrator deletion cannot orphan AWS resources", async () => {
  const f = await fixture()
  await expect(
    f.owner.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: false,
    })
  ).rejects.toThrow("sending domains")
  await expect(
    f.owner.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: true,
    })
  ).rejects.toThrow("sending domains")
  await expect(
    f.owner.client.mutation(api.teams.deleteAccount)
  ).rejects.toThrow("installation administrator")
  expect((await f.owner.client.query(api.teams.snapshot))?.teams).toHaveLength(
    1
  )
})

test("setup generates its encryption key without an SES env variable and never exposes it", async () => {
  const f = await fixture()
  vi.stubEnv("BETTER_AUTH_SECRET", "test-server-secret-".repeat(4))
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("SES_ENCRYPTION_KEY", "")
  await f.owner.client.action(api.installationActions.initialize, {})
  const first = await f.owner.client.query(internal.installation.adminContext)
  expect(first?.wrappedEncryptionKey).toBeTruthy()
  await f.owner.client.action(api.installationActions.initialize, {})
  const second = await f.owner.client.query(internal.installation.adminContext)
  expect(second?.wrappedEncryptionKey).toBe(first?.wrappedEncryptionKey)
  const status = await f.owner.client.query(api.installation.status)
  expect(JSON.stringify(status)).not.toContain(first!.wrappedEncryptionKey!)
  await expect(
    f.outsider.client.action(api.installationActions.initialize, {})
  ).rejects.toThrow("installation administrator")
  const credentials = {
    kind: "keys" as const,
    accessKeyId: "TEST",
    secretAccessKey: "secret",
  }
  const encrypted = encryptCredentials(
    credentials,
    f.installation,
    first!.wrappedEncryptionKey
  )
  expect(encrypted.startsWith("v2.")).toBe(true)
  expect(
    decryptCredentials(encrypted, f.installation, first!.wrappedEncryptionKey)
  ).toEqual(credentials)
  expect(() =>
    decryptCredentials(
      encrypted,
      f.installation,
      createWrappedKey(f.installation)
    )
  ).toThrow()
  vi.stubEnv("BETTER_AUTH_SECRET", "different-server-secret-".repeat(4))
  expect(() =>
    decryptCredentials(encrypted, f.installation, first!.wrappedEncryptionKey)
  ).toThrow()
})

test("wizard progress persists and cannot skip missing setup prerequisites", async () => {
  const f = await fixture()
  await f.owner.client.mutation(api.installation.navigate, { step: "callback" })
  expect(
    (await f.owner.client.query(api.installation.status)).installation
      ?.setupStep
  ).toBe("callback")
  await f.t.run((ctx) =>
    ctx.db.patch(f.installation, { environmentCheckedAt: 0 })
  )
  await expect(
    f.owner.client.mutation(api.installation.navigate, { step: "team" })
  ).rejects.toThrow("delivery updates")
  await expect(
    f.outsider.client.mutation(api.installation.navigate, { step: "aws" })
  ).rejects.toThrow("installation administrator")
})

test("setup gates teams and invitations, with one first-team creation at the wizard step", async () => {
  vi.useFakeTimers()
  const f = await fixture()
  await f.t.run((ctx) =>
    ctx.db.patch(f.installation, { completedAt: undefined, setupStep: "aws" })
  )
  await expect(
    f.owner.client.mutation(api.teams.create, { name: "Bypass" })
  ).rejects.toThrow("team step")
  await expect(
    f.owner.client.mutation(api.teams.invite, {
      organizationId: f.owner.team,
      email: "invited@example.test",
      role: "member",
    })
  ).rejects.toThrow("Finish installation")
  await expect(
    f.outsider.client.mutation(api.teams.create, { name: "Bypass" })
  ).rejects.toThrow("team step")
  await expect(
    f.owner.client.mutation(api.teams.switchTeam, {
      organizationId: f.owner.team,
    })
  ).rejects.toThrow("Finish installation")
  await expect(
    f.owner.client.mutation(api.teams.deleteAccount)
  ).rejects.toThrow("Finish installation")
  // Fixture setup uses the internal auth component; public application calls stay gated.
  await f.t.mutation(components.betterAuth.teams.remove, {
    sessionId: f.owner.session._id,
    organizationId: f.owner.team,
    leave: false,
  })
  await f.t.run((ctx) => ctx.db.patch(f.installation, { setupStep: "team" }))
  await f.owner.client.mutation(api.teams.create, { name: "First team" })
  expect(
    (await f.owner.client.query(api.installation.status)).installation
      ?.setupStep
  ).toBe("domain")
  await expect(
    f.owner.client.mutation(api.teams.create, { name: "Second team" })
  ).rejects.toThrow("team step")
  await f.t.run((ctx) =>
    ctx.db.patch(f.installation, { completedAt: Date.now() })
  )
  await expect(
    f.owner.client.mutation(api.teams.create, { name: "Second team" })
  ).resolves.toBeTruthy()
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
})

describe("native SES team tenants", () => {
  test("creates an unacknowledged tenant before reading it when missing lookups are denied", async () => {
    const f = await awsFixture()
    f.aws.tenants.delete(f.tenantName)
    f.aws.denyMissingTenantLookup = true
    await f.t.run((ctx) =>
      ctx.db.patch(f.tenant, {
        arn: undefined,
        phase: "running",
        generation: 2,
      })
    )
    await f.t.action(internal.ses.tenantActions.run, {
      tenantId: f.tenant,
      generation: 2,
    })
    expect(f.aws.calls.slice(0, 2)).toEqual([
      "CreateTenantCommand",
      "GetTenantCommand",
    ])
    expect(
      (await f.t.query(internal.tenants.get, { id: f.tenant }))?.phase
    ).toBe("ready")
    // Model a lost acknowledgment: retry the same name without a stored ARN.
    await f.t.run((ctx) =>
      ctx.db.patch(f.tenant, {
        arn: undefined,
        phase: "running",
        generation: 3,
      })
    )
    await f.t.action(internal.ses.tenantActions.run, {
      tenantId: f.tenant,
      generation: 3,
    })
    expect(f.aws.tenants.size).toBe(1)
    expect(
      (await f.t.query(internal.tenants.get, { id: f.tenant }))?.phase
    ).toBe("ready")
  })
  test("a new tenant name collision checks ownership before changing the existing tenant", async () => {
    const f = await awsFixture()
    const original = f.aws.tenants.get(f.tenantName)!
    original.Tags = [
      { Key: "opensend:installation", Value: "another-installation" },
    ]
    await f.t.run((ctx) =>
      ctx.db.patch(f.tenant, {
        arn: undefined,
        phase: "running",
        generation: 2,
      })
    )
    await f.t.action(internal.ses.tenantActions.run, {
      tenantId: f.tenant,
      generation: 2,
    })
    expect(f.aws.calls).toEqual(["CreateTenantCommand", "GetTenantCommand"])
    expect(f.aws.tenants.get(f.tenantName)).toBe(original)
    expect(
      (await f.t.query(internal.tenants.get, { id: f.tenant }))?.phase
    ).toBe("failed")
  })
  test("new teams provision distinct regional SES tenants with tenant suppression", async () => {
    vi.useFakeTimers()
    const f = await awsFixture()
    const teams = await Promise.all(
      ["Tenant A", "Tenant B"].map((name) =>
        f.owner.client.mutation(api.teams.create, { name })
      )
    )
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    const a = (
      await f.owner.client.query(api.tenants.list, { organizationId: teams[0] })
    )[0]
    const b = (
      await f.owner.client.query(api.tenants.list, { organizationId: teams[1] })
    )[0]
    expect(a.name).not.toBe(b.name)
    expect(a.phase).toBe("ready")
    expect(b.phase).toBe("ready")
    expect(f.aws.tenants.get(a.name)?.SuppressionAttributes).toEqual({
      SuppressionScope: "TENANT",
      SuppressedReasons: ["BOUNCE", "COMPLAINT"],
    })
    expect(f.aws.tenants.get(a.name)?.Tags).toContainEqual({
      Key: "opensend:team",
      Value: teams[0],
    })
    await expect(
      f.outsider.client.query(api.tenants.list, { organizationId: teams[0] })
    ).rejects.toThrow("permission")
  })
  test("association failures never mark a domain ready; retry binds identity and configuration set", async () => {
    const f = await awsFixture()
    f.aws.failAssociation = true
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    let domain = (await f.owner.client.query(api.domains.get, {
      id: f.domain,
    }))!.domain
    expect(domain.phase).toBe("failed")
    expect(domain.tenantAssociated).toBe(false)
    f.aws.failAssociation = false
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    domain = (await f.owner.client.query(api.domains.get, { id: f.domain }))!
      .domain
    expect(domain.tenantAssociated).toBe(true)
    expect([...f.aws.associations.keys()]).toHaveLength(2)
    for (const members of f.aws.associations.values())
      expect([...members]).toEqual([f.tenantName])
  })
  test("existing resources associated with another tenant are refused without reconfiguration", async () => {
    const f = await awsFixture()
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    const identityArn = `arn:aws:ses:us-east-1:123456789012:identity/mail.example.test`
    f.aws.associations.get(identityArn)!.add("unrelated-tenant")
    f.aws.calls.length = 0
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    const result = await f.owner.client.query(api.domains.get, { id: f.domain })
    expect(result?.domain.phase).toBe("failed")
    expect(result?.domain.error).toContain("another tenant")
    expect(f.aws.calls).not.toContain(
      "PutEmailIdentityMailFromAttributesCommand"
    )
    expect(f.aws.calls).not.toContain("DeleteTenantResourceAssociationCommand")
  })
  test("a colliding tenant name cannot be adopted from another team", async () => {
    const f = await awsFixture()
    f.aws.tenants.get(f.tenantName)!.Tags = [
      { Key: "opensend:installation", Value: f.installation },
      { Key: "opensend:team", Value: "different-team" },
    ]
    await f.t.run((ctx) =>
      ctx.db.patch(f.tenant, { phase: "running", generation: 2 })
    )
    await f.t.action(internal.ses.tenantActions.run, {
      tenantId: f.tenant,
      generation: 2,
    })
    expect(
      (await f.t.query(internal.tenants.get, { id: f.tenant }))?.error
    ).toContain("another team")
    expect(f.aws.calls).not.toContain("CreateTenantCommand")
    expect(f.aws.calls).not.toContain("PutTenantSuppressionAttributesCommand")
  })
  test("domain and team teardown disassociates resources before deletion", async () => {
    vi.useFakeTimers()
    const f = await awsFixture()
    await f.t.action(internal.ses.provision.domain, { domainId: f.domain })
    f.aws.calls.length = 0
    await f.owner.client.mutation(api.domains.remove, { id: f.domain })
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    expect(
      f.aws.calls.indexOf("DeleteTenantResourceAssociationCommand")
    ).toBeLessThan(f.aws.calls.indexOf("DeleteEmailIdentityCommand"))
    expect((await f.t.run((ctx) => ctx.db.get(f.domain)))?.deleted).toBe(true)
    await f.owner.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: false,
    })
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    expect(f.aws.calls).toContain("DeleteTenantCommand")
    expect(
      (await f.t.query(internal.tenants.get, { id: f.tenant }))?.deleted
    ).toBe(true)
  })
  test("unexpected tenant resources stop cleanup and remain intact until an administrator retries", async () => {
    vi.useFakeTimers()
    const f = await awsFixture()
    await f.t.run((ctx) => ctx.db.patch(f.domain, { deleted: true }))
    f.aws.associations.set(
      "arn:aws:ses:us-east-1:123456789012:identity/unrelated.test",
      new Set([f.tenantName])
    )
    await f.owner.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: false,
    })
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    expect(f.aws.calls).not.toContain("DeleteTenantCommand")
    expect(f.aws.calls).not.toContain("DeleteEmailIdentityCommand")
    expect(await f.owner.client.query(api.tenants.cleanup)).toHaveLength(1)
    await expect(
      f.outsider.client.mutation(api.tenants.retryCleanup, { id: f.tenant })
    ).rejects.toThrow("installation administrator")
    f.aws.associations.clear()
    await f.owner.client.mutation(api.tenants.retryCleanup, { id: f.tenant })
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    expect(
      (await f.t.query(internal.tenants.get, { id: f.tenant }))?.deleted
    ).toBe(true)
  })
  test("stale lifecycle workers cannot overwrite a newer removal operation", async () => {
    const f = await awsFixture()
    await f.t.run((ctx) =>
      ctx.db.patch(f.tenant, {
        phase: "running",
        generation: 2,
        operation: "remove",
      })
    )
    await f.t.action(internal.ses.tenantActions.run, {
      tenantId: f.tenant,
      generation: 1,
    })
    await f.t.mutation(internal.tenants.finish, {
      id: f.tenant,
      generation: 1,
      sendingStatus: "ENABLED",
    })
    expect(f.aws.calls).toEqual([])
    expect(
      await f.t.query(internal.tenants.get, { id: f.tenant })
    ).toMatchObject({ phase: "running", generation: 2, operation: "remove" })
  })
  test("send context always binds the team's TenantName and rejects missing associations or a paused tenant", async () => {
    const f = await awsFixture()
    await expect(
      f.t.query(internal.ses.sendContext.get, {
        organizationId: f.owner.team,
        domainId: f.domain,
      })
    ).rejects.toThrow("Domain is not ready")
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.domain, {
        status: "verified",
        tenantAssociated: true,
        configurationSet: "team-configuration",
      })
      await ctx.db.patch(f.region._id, {
        callbackConfirmed: true,
        quota: { ...f.region.quota, production: true },
      })
    })
    expect(
      await f.t.query(internal.ses.sendContext.get, {
        organizationId: f.owner.team,
        domainId: f.domain,
      })
    ).toMatchObject({
      TenantName: f.tenantName,
      ConfigurationSetName: "team-configuration",
    })
    await expect(
      f.t.query(internal.ses.sendContext.get, {
        organizationId: f.outsider.team,
        domainId: f.domain,
      })
    ).rejects.toThrow("does not belong")
    await f.t.run((ctx) =>
      ctx.db.patch(f.tenant, { sendingStatus: "DISABLED" })
    )
    await expect(
      f.t.query(internal.ses.sendContext.get, {
        organizationId: f.owner.team,
        domainId: f.domain,
      })
    ).rejects.toThrow("tenant is not ready")
  })
  test("management calls reserve separate slots per AWS region", async () => {
    vi.useFakeTimers()
    const f = await fixture()
    expect(
      await f.t.mutation(internal.ses.limits.reserve, { region: "us-east-1" })
    ).toBe(0)
    expect(
      await f.t.mutation(internal.ses.limits.reserve, { region: "us-east-1" })
    ).toBeGreaterThanOrEqual(1000)
    expect(
      await f.t.mutation(internal.ses.limits.reserve, { region: "eu-west-1" })
    ).toBe(0)
  })
})

test("setup completion requires a ready tenant belonging to the first domain's team", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.installation, { completedAt: undefined })
    await ctx.db.patch(f.domain, {
      tenantAssociated: false,
      phase: "failed",
      status: "failed",
    })
    await ctx.db.patch(f.tenant, { phase: "failed" })
  })
  await expect(
    f.owner.client.mutation(api.installation.complete, {
      organizationId: f.owner.team,
    })
  ).rejects.toThrow("Provision")
  await f.t.run((ctx) =>
    ctx.db.patch(f.tenant, { phase: "ready", organizationId: f.outsider.team })
  )
  await expect(
    f.owner.client.mutation(api.installation.complete, {
      organizationId: f.owner.team,
    })
  ).rejects.toThrow("Provision")
  await f.t.run((ctx) =>
    ctx.db.patch(f.tenant, { organizationId: f.owner.team })
  )
  await f.owner.client.mutation(api.installation.complete, {
    organizationId: f.owner.team,
  })
  expect(
    (await f.owner.client.query(api.installation.status)).installation
      ?.completedAt
  ).toBeTruthy()
  await expect(
    f.owner.client.mutation(api.tenants.retry, {
      organizationId: f.owner.team,
      region: "eu-west-1",
    })
  ).rejects.toThrow("Provision this AWS region")
})

test("saving the first domain atomically completes setup before AWS/DNS verification", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.installation, {
      completedAt: undefined,
      setupStep: "domain",
    })
    await ctx.db.patch(f.domain, { deleted: true })
  })
  const id = await f.owner.client.mutation(api.domains.create, {
    organizationId: f.owner.team,
    name: "new.example.test",
    region: "us-east-1",
    customReturnPath: "send",
  })
  expect(
    (await f.owner.client.query(api.installation.status)).installation
      ?.completedAt
  ).toBeTruthy()
  const domain = (await f.owner.client.query(api.domains.get, { id }))!.domain
  expect(domain.records).toEqual([])
  expect(domain.sesVerified).toBe(false)
  await expect(
    f.t.query(internal.ses.sendContext.get, {
      organizationId: f.owner.team,
      domainId: id,
    })
  ).rejects.toBeTruthy()
})

test("first domain creation rolls back if team setup is not ready", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.installation, {
      completedAt: undefined,
      setupStep: "domain",
    })
    await ctx.db.patch(f.domain, { deleted: true })
    await ctx.db.patch(f.tenant, { phase: "failed" })
  })
  await expect(
    f.owner.client.mutation(api.domains.create, {
      organizationId: f.owner.team,
      name: "new.example.test",
      region: "us-east-1",
      customReturnPath: "send",
    })
  ).rejects.toThrow("team tenant")
  expect(
    (await f.owner.client.query(api.installation.status)).installation
      ?.completedAt
  ).toBeUndefined()
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("domains")
        .withIndex("by_name_and_region", (q) =>
          q.eq("name", "new.example.test").eq("region", "us-east-1")
        )
        .unique()
    )
  ).toBeNull()
})

describe("DNS provider detection", () => {
  test("uses nameserver boundaries and does not confuse mixed or custom nameservers", () => {
    expect(
      providerFromNameservers([
        "ALICE.NS.CLOUDFLARE.COM.",
        "bob.ns.cloudflare.com",
      ])
    ).toBe("cloudflare")
    expect(
      providerFromNameservers([
        "ns-123.awsdns-45.com",
        "ns-456.awsdns-12.co.uk",
      ])
    ).toBe("route53")
    expect(providerFromNameservers(["ns01.domaincontrol.com"])).toBe("godaddy")
    expect(
      providerFromNameservers([
        "artemis.dns-parking.com",
        "hermes.dns-parking.com",
      ])
    ).toBe("hostinger")
    expect(providerFromNameservers(["dns1.registrar-servers.com"])).toBe(
      "namecheap"
    )
    expect(providerFromNameservers(["alice.ns.cloudflare.com.evil.test"])).toBe(
      "other"
    )
    expect(
      providerFromNameservers(["alice.ns.cloudflare.com", "ns1.custom.test"])
    ).toBe("other")
    expect(providerFromNameservers([])).toBeUndefined()
  })
  test("finds a subdomain's parent zone and stops on temporary failures", async () => {
    const resolveNs = vi
      .fn()
      .mockRejectedValueOnce({ code: "ENODATA" })
      .mockResolvedValueOnce(["alice.ns.cloudflare.com"])
    expect(await detectDnsProvider("app.example.com", { resolveNs })).toBe(
      "cloudflare"
    )
    expect(resolveNs.mock.calls.map((call) => call[0])).toEqual([
      "app.example.com",
      "example.com",
    ])
    const unavailable = vi.fn().mockRejectedValue({ code: "ETIMEOUT" })
    expect(
      await detectDnsProvider("app.example.com", { resolveNs: unavailable })
    ).toBeUndefined()
    expect(unavailable).toHaveBeenCalledTimes(1)
  })
  test("authorizes lookups, caches results and rejects stale writes", async () => {
    const f = await fixture()
    await expect(
      f.outsider.client.mutation(internal.domains.claimDnsProviderLookup, {
        id: f.domain,
      })
    ).rejects.toThrow("permission")
    const lookup = await f.owner.client.mutation(
      internal.domains.claimDnsProviderLookup,
      { id: f.domain }
    )
    expect(lookup?.name).toBe("mail.example.test")
    expect(
      await f.owner.client.mutation(internal.domains.claimDnsProviderLookup, {
        id: f.domain,
      })
    ).toBeNull()
    await f.owner.client.mutation(internal.domains.saveDnsProvider, {
      id: f.domain,
      requestedAt: lookup!.requestedAt - 1,
      provider: "cloudflare",
    })
    expect(
      (await f.owner.client.query(api.domains.get, { id: f.domain }))?.domain
        .dnsProvider
    ).toBeUndefined()
    await f.owner.client.mutation(internal.domains.saveDnsProvider, {
      id: f.domain,
      requestedAt: lookup!.requestedAt,
      provider: "cloudflare",
    })
    expect(
      (await f.owner.client.query(api.domains.get, { id: f.domain }))?.domain
        .dnsProvider
    ).toBe("cloudflare")
    expect(
      await f.owner.client.mutation(internal.domains.claimDnsProviderLookup, {
        id: f.domain,
      })
    ).toBeNull()
  })
})

test("TLS changes preserve verified DNS, identity state and tenant associations, including on failure", async () => {
  vi.useFakeTimers()
  const f = await awsFixture()
  f.aws.config = true
  const records = [
    {
      id: "dkim",
      kind: "DKIM" as const,
      type: "CNAME" as const,
      name: "token._domainkey.mail.example.test",
      value: "token.dkim.amazonses.com",
      ttl: "300",
      status: "verified" as const,
    },
  ]
  await f.t.run((ctx) =>
    ctx.db.patch(f.domain, {
      records,
      status: "verified",
      sesVerified: true,
      dkimVerified: true,
      mailFromVerified: true,
      tenantAssociated: true,
    })
  )
  await f.owner.client.mutation(api.domains.update, {
    id: f.domain,
    tls: "enforced",
  })
  expect(
    (await f.owner.client.query(api.domains.get, { id: f.domain }))?.domain.tls
  ).toBe("opportunistic")
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  const saved = (await f.owner.client.query(api.domains.get, { id: f.domain }))!
    .domain
  expect(saved).toMatchObject({
    tls: "enforced",
    phase: "ready",
    status: "verified",
    records,
    tenantAssociated: true,
    sesVerified: true,
    dkimVerified: true,
    mailFromVerified: true,
  })
  expect(saved.pendingTls).toBeUndefined()
  expect(f.aws.tlsPolicy).toBe("REQUIRE")
  expect(f.aws.calls).not.toContain("GetEmailIdentityCommand")
  expect(f.aws.calls).not.toContain("PutEmailIdentityMailFromAttributesCommand")
  expect(vi.mocked(Resolver.prototype.resolveCname)).not.toHaveBeenCalled()
  f.aws.failTls = true
  await f.owner.client.mutation(api.domains.update, {
    id: f.domain,
    tls: "opportunistic",
  })
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  expect(
    (await f.owner.client.query(api.domains.get, { id: f.domain }))!.domain
  ).toMatchObject({
    tls: "enforced",
    pendingTls: "opportunistic",
    phase: "failed",
    status: "verified",
    records,
    tenantAssociated: true,
    sesVerified: true,
    dkimVerified: true,
    mailFromVerified: true,
  })
})
