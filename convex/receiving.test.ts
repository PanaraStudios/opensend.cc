import * as publicHttp from "../lib/net/public-fetch"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Resolver } from "node:dns/promises"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { SNSClient } from "@aws-sdk/client-sns"
import { api, components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { mockInboundAws } from "./testHelpers/inboundAws.fixture"
import {
  INBOUND_BUCKET,
  INBOUND_CERT_PEM,
  INBOUND_NOTIFICATION,
  INBOUND_SUBSCRIPTION_CONFIRMATION,
  INBOUND_TOPIC_ARN,
  INBOUND_UNROUTED,
} from "./testHelpers/inboundSns.fixture"
import {
  inboundBucketName,
  requireReceivingRegion,
  resourcePrefix,
  shortRegion,
} from "./ses/contracts"

beforeEach(() => vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32)))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Fixture = Awaited<ReturnType<typeof fixture>>

/** A plain member (not an admin) of the owner's team. */
async function member(f: Fixture) {
  const other = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: other.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  return other
}

/** A verified, provisioned domain whose SES side is all in place, and DNS
    that publishes everything except what `zone` leaves out. */
async function receivingWorld() {
  vi.useFakeTimers()
  const f = await fixture()
  await storeTestCredentials(f)
  const domains: Id<"domains">[] = [f.domain]
  const ses: { name: string; input: Record<string, unknown> }[] = []
  const tags = () => [
    { Key: "opensend:installation", Value: f.installation },
    ...domains.map((id) => ({ Key: "opensend:domain", Value: id })),
  ]
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
    async (command) => {
      const name = command.constructor.name
      ses.push({ name, input: command.input as Record<string, unknown> })
      if (name === "GetTenantCommand")
        return {
          Tenant: {
            TenantName: f.tenantName,
            TenantId: "provider-tenant",
            TenantArn: `arn:aws:ses:us-east-1:123456789012:tenant/${f.tenantName}/provider-tenant`,
            Tags: [
              { Key: "opensend:installation", Value: f.installation },
              { Key: "opensend:team", Value: f.owner.team },
            ],
            SendingStatus: "ENABLED",
          },
        } as never
      if (name === "ListResourceTenantsCommand")
        return { ResourceTenants: [{ TenantName: f.tenantName }] } as never
      if (name === "GetEmailIdentityCommand")
        return {
          Tags: tags(),
          VerifiedForSendingStatus: true,
          DkimAttributes: {
            Tokens: ["provider-token"],
            SigningHostedZone: "regional.dkim.amazonses.com",
            Status: "SUCCESS",
            SigningEnabled: true,
          },
          MailFromAttributes: {
            MailFromDomain: `send.${(command.input as { EmailIdentity: string }).EmailIdentity}`,
            MailFromDomainStatus: "SUCCESS",
            BehaviorOnMxFailure: "REJECT_MESSAGE",
          },
        } as never
      if (name === "ListTagsForResourceCommand")
        return { Tags: tags() } as never
      if (name === "GetConfigurationSetEventDestinationsCommand")
        return { EventDestinations: [{ Name: "opensend-events" }] } as never
      if (name === "GetAccountCommand")
        return { SendQuota: { Max24HourSend: 200, MaxSendRate: 1 } } as never
      return {} as never
    }
  )
  const zone = { tracking: false }
  vi.spyOn(Resolver.prototype, "resolveNs").mockResolvedValue([])
  vi.spyOn(Resolver.prototype, "resolveCname").mockImplementation(
    async (name) =>
      name.startsWith("links.")
        ? zone.tracking
          ? ["api.opensend.test"]
          : []
        : ["provider-token.regional.dkim.amazonses.com"]
  )
  vi.spyOn(Resolver.prototype, "resolveMx").mockImplementation(async (name) =>
    name.startsWith("send.")
      ? [{ exchange: "feedback-smtp.us-east-1.amazonses.com", priority: 10 }]
      : [{ exchange: "inbound-smtp.us-east-1.amazonaws.com", priority: 10 }]
  )
  vi.spyOn(Resolver.prototype, "resolveTxt").mockImplementation(async (name) =>
    name.startsWith("_dmarc.")
      ? [["v=DMARC1; p=none;"]]
      : [["v=spf1 include:amazonses.com ~all"]]
  )
  const aws = mockInboundAws(f.installation)
  await f.t.run((ctx) =>
    ctx.db.patch("domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      sesVerified: true,
      dkimVerified: true,
      mailFromVerified: true,
      configurationSet: `${resourcePrefix(f.installation)}-${f.domain.slice(-12)}`,
    })
  )
  const settle = () =>
    f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  const readDomain = async (id: Id<"domains"> = f.domain) =>
    (await f.t.run((ctx) => ctx.db.get("domains", id)))!
  const inbound = () =>
    f.t.run(async (ctx) =>
      ctx.db
        .query("inboundRegions")
        .withIndex("by_region", (q) => q.eq("region", "us-east-1"))
        .unique()
    )
  /** Another provisioned domain of the same team. */
  const addDomain = async (name: string) => {
    const fields = Object.fromEntries(
      Object.entries(await readDomain()).filter(([key]) => !key.startsWith("_"))
    ) as Omit<Doc<"domains">, "_id" | "_creationTime">
    const id = await f.t.run((ctx) =>
      ctx.db.insert("domains", {
        ...fields,
        name,
        receiving: false,
        receiptRuleSet: undefined,
      })
    )
    domains.push(id)
    return id
  }
  return { ...f, aws, ses, zone, settle, readDomain, inbound, addDomain }
}
const ours = (f: Fixture) => `${resourcePrefix(f.installation)}-inbound`
const ruleName = (f: Fixture, id: string) =>
  `${resourcePrefix(f.installation)}-${id.slice(-12)}`

describe("inbound mail setup", () => {
  test("a plain member's first receiving domain sets up the region and adds its rule", async () => {
    const f = await receivingWorld()
    const m = await member(f)
    await m.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: true,
    })
    await f.settle()
    const bucket = inboundBucketName(f.installation, "us-east-1")
    const topicArn = `arn:aws:sns:us-east-1:123456789012:${resourcePrefix(f.installation)}-inbound`
    expect(await f.inbound()).toMatchObject({
      operation: "provision",
      phase: "ready",
      bucket,
      topicArn,
      ruleSet: ours(f),
      ownsRuleSet: true,
    })
    expect(await f.readDomain()).toMatchObject({
      phase: "ready",
      receiving: true,
      receiptRuleSet: ours(f),
    })
    // No rule set was active, so ours was created and activated.
    expect(f.aws.state.active).toBe(ours(f))
    expect(f.aws.state.sets.get(ours(f))).toEqual([
      {
        Name: ruleName(f, f.domain),
        Enabled: true,
        TlsPolicy: "Optional",
        ScanEnabled: true,
        Recipients: ["mail.example.test"],
        Actions: [
          {
            S3Action: {
              BucketName: bucket,
              ObjectKeyPrefix: `${f.domain}/`,
              TopicArn: topicArn,
            },
          },
        ],
      },
    ])
    // us-east-1 is S3's default location, which refuses an explicit one.
    const create = f.aws.state.calls.find(
      (c) => c.name === "CreateBucketCommand"
    )!
    expect(create.input).toEqual({ Bucket: bucket })
    expect(
      f.aws.state.calls.find(
        (c) => c.name === "PutBucketLifecycleConfigurationCommand"
      )?.input
    ).toEqual({
      Bucket: bucket,
      ExpectedBucketOwner: "123456789012",
      LifecycleConfiguration: {
        Rules: [
          {
            ID: "opensend-transient-inbound",
            Status: "Enabled",
            Filter: { Prefix: "" },
            Expiration: { Days: 1 },
          },
        ],
      },
    })
    // SES may write only through this installation's receipt rules.
    const grant = JSON.parse(f.aws.state.bucketPolicy!).Statement[0]
    expect(grant).toMatchObject({
      Principal: { Service: "ses.amazonaws.com" },
      Action: "s3:PutObject",
      Resource: `arn:aws:s3:::${bucket}/*`,
      Condition: {
        StringEquals: { "AWS:SourceAccount": "123456789012" },
        ArnLike: {
          "AWS:SourceArn": `arn:aws:ses:us-east-1:123456789012:receipt-rule-set/*:receipt-rule/${resourcePrefix(f.installation)}-*`,
        },
      },
    })
    for (const call of f.aws.state.calls.filter((c) =>
      c.name.includes("Bucket")
    ))
      if (call.name !== "CreateBucketCommand")
        expect(call.input.ExpectedBucketOwner).toBe("123456789012")
    // Another team's publish grant on the topic is kept.
    expect(
      JSON.parse(f.aws.state.topicPolicy).Statement.map(
        (s: { Sid: string }) => s.Sid
      )
    ).toEqual(["__default_statement_ID", "OpensendSesInboundPublish"])
    expect(
      f.aws.state.calls.find((c) => c.name === "SubscribeCommand")!.input
    ).toMatchObject({
      Endpoint: "https://api.opensend.test/ses/inbound",
      Protocol: "https",
    })
    // The bucket admits SES before any rule that writes to it exists.
    const names = f.aws.state.calls.map((c) => c.name)
    expect(names.indexOf("PutBucketPolicyCommand")).toBeLessThan(
      names.indexOf("CreateReceiptRuleCommand")
    )
    // A refresh updates the rule in place.
    await f.owner.client.mutation(api.domains.refresh, { id: f.domain })
    await f.settle()
    expect(f.aws.state.sets.get(ours(f))).toHaveLength(1)
    expect(f.aws.count("UpdateReceiptRuleCommand")).toBe(1)
    expect(f.aws.count("CreateBucketCommand")).toBe(1)
  })

  test("an active rule set is adopted and never replaced or deactivated", async () => {
    const f = await receivingWorld()
    f.aws.state.active = "their-rules"
    f.aws.state.sets.set("their-rules", [
      { Name: "their-rule", Recipients: ["example.org"] },
    ])
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: true,
    })
    await f.settle()
    expect(await f.inbound()).toMatchObject({
      phase: "ready",
      ruleSet: "their-rules",
      ownsRuleSet: false,
    })
    expect(f.aws.count("CreateReceiptRuleSetCommand")).toBe(0)
    expect(f.aws.count("SetActiveReceiptRuleSetCommand")).toBe(0)
    // Ours goes first, so their rules' stop actions never hold mail back.
    expect(
      f.aws.state.sets.get("their-rules")!.map((rule) => rule.Name)
    ).toEqual([ruleName(f, f.domain), "their-rule"])
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: false,
    })
    await f.settle()
    expect(await f.readDomain()).toMatchObject({
      receiving: false,
      phase: "ready",
    })
    expect((await f.readDomain()).receiptRuleSet).toBeUndefined()
    expect(
      f.aws.state.sets.get("their-rules")!.map((rule) => rule.Name)
    ).toEqual(["their-rule"])
    expect(await f.inbound()).toMatchObject({
      operation: "cleanup",
      phase: "ready",
    })
    expect(f.aws.count("SetActiveReceiptRuleSetCommand")).toBe(0)
    expect(f.aws.state.active).toBe("their-rules")
  })

  test("a set activated by someone else meanwhile is never replaced", async () => {
    const f = await receivingWorld()
    let reads = 0
    f.aws.state.onCall = (name) => {
      // The second look, just before activating, finds someone else's set.
      if (name === "DescribeActiveReceiptRuleSetCommand" && ++reads === 2)
        f.aws.state.active = "their-rules"
    }
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: true,
    })
    await f.settle()
    expect(f.aws.count("SetActiveReceiptRuleSetCommand")).toBe(0)
    expect((await f.readDomain()).error).toContain(
      "Inbound mail setup for this region failed: Another receipt rule set was activated"
    )
  })

  test("only the last receiving domain's removal winds the region down, and only our own empty set is deactivated", async () => {
    const f = await receivingWorld()
    const other = await f.addDomain("other.example.test")
    for (const id of [f.domain, other]) {
      await f.owner.client.mutation(api.domains.update, { id, receiving: true })
      await f.settle()
    }
    expect(f.aws.state.sets.get(ours(f))).toHaveLength(2)
    expect(f.aws.count("CreateBucketCommand")).toBe(1)
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: false,
    })
    await f.settle()
    expect(await f.inbound()).toMatchObject({ operation: "provision" })
    expect(f.aws.state.active).toBe(ours(f))
    // Removing the other domain removes its rule, the last one.
    await f.owner.client.mutation(api.domains.remove, { id: other })
    await f.settle()
    expect(f.aws.state.sets.get(ours(f))).toEqual([])
    expect(await f.inbound()).toMatchObject({
      operation: "cleanup",
      phase: "ready",
    })
    expect(f.aws.state.active).toBeUndefined()
    // The bucket and its mail are kept; nothing deletes them.
    expect(f.aws.state.bucket).toBe(true)
    expect(
      f.aws.state.calls.filter((c) => /Delete(Bucket|Topic)/.test(c.name))
    ).toEqual([])
    // Turning receiving on again reuses everything and reactivates our set.
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: true,
    })
    await f.settle()
    expect(await f.inbound()).toMatchObject({
      operation: "provision",
      phase: "ready",
    })
    expect(f.aws.state.active).toBe(ours(f))
    expect(f.aws.count("CreateBucketCommand")).toBe(1)
    expect(f.aws.count("CreateTopicCommand")).toBe(1)
    expect(f.aws.count("CreateReceiptRuleSetCommand")).toBe(1)
  })

  test("a run that stopped part-way resumes without duplicating anything and keeps AWS details private", async () => {
    const f = await receivingWorld()
    f.aws.state.fail.PutBucketPolicyCommand = "AccessDenied"
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: true,
    })
    await f.settle()
    const failed = await f.readDomain()
    expect(failed).toMatchObject({ phase: "failed", receiving: true })
    // A failed refresh leaves a verified domain sending.
    expect(failed.status).toBe("verified")
    expect(failed.error).toContain("Inbound mail setup for this region failed")
    expect(failed.error).not.toContain("provider detail")
    expect(await f.inbound()).toMatchObject({ phase: "failed" })
    delete f.aws.state.fail.PutBucketPolicyCommand
    await f.owner.client.mutation(api.domains.refresh, { id: f.domain })
    await f.settle()
    expect(await f.readDomain()).toMatchObject({
      phase: "ready",
      receiptRuleSet: ours(f),
    })
    expect(f.aws.count("CreateBucketCommand")).toBe(1)
    expect(f.aws.count("PutBucketTaggingCommand")).toBe(1)
    expect(f.aws.count("CreateTopicCommand")).toBe(1)
    expect(f.aws.count("SubscribeCommand")).toBe(1)
    expect(f.aws.count("CreateReceiptRuleCommand")).toBe(1)
  })

  test("a bucket tagged by someone else is refused", async () => {
    const f = await receivingWorld()
    f.aws.state.bucket = true
    f.aws.state.bucketTags = [{ Key: "owner", Value: "someone-else" }]
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: true,
    })
    await f.settle()
    expect(await f.inbound()).toMatchObject({ phase: "failed" })
    expect(f.aws.count("PutBucketPolicyCommand")).toBe(0)
  })

  test("teams toggle only their own domains; the region's state is the super admin's", async () => {
    const f = await receivingWorld()
    await expect(
      f.outsider.client.mutation(api.domains.update, {
        id: f.domain,
        receiving: true,
      })
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.query(api.ses.inboundRegions.list, {})
    ).rejects.toThrow("installation administrator")
    const m = await member(f)
    await expect(
      m.client.query(api.ses.inboundRegions.list, {})
    ).rejects.toThrow("installation administrator")
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      receiving: true,
    })
    await f.settle()
    expect(await f.owner.client.query(api.ses.inboundRegions.list, {})).toEqual(
      [expect.objectContaining({ region: "us-east-1", phase: "ready" })]
    )
  })
})

describe("receiving regions and names", () => {
  test("unsupported regions are refused and bucket names fit S3's limit", () => {
    for (const region of [
      "us-east-1",
      "eu-west-1",
      "sa-east-1",
      "ap-northeast-1",
    ])
      expect(() => requireReceivingRegion(region)).not.toThrow()
    expect(() => requireReceivingRegion("us-gov-west-1")).toThrow(
      "Amazon SES does not receive email in us-gov-west-1"
    )
    expect(() => requireReceivingRegion("ap-south-2")).toThrow()
    expect(
      [
        "us-east-1",
        "eu-west-1",
        "sa-east-1",
        "ap-northeast-1",
        "ap-southeast-2",
        "eu-central-1",
      ].map(shortRegion)
    ).toEqual(["use1", "euw1", "sae1", "apne1", "apse2", "euc1"])
    const id = "k".repeat(32)
    for (const region of ["us-east-1", "ap-northeast-1"]) {
      const name = inboundBucketName(id, region)
      expect(name.length).toBeLessThanOrEqual(63)
      expect(name).toMatch(/^opensend-k{32}-inbound-[a-z0-9]+$/)
    }
    expect(inboundBucketName(id, "ap-northeast-1")).toMatch(/-inbound-apne1$/)
    expect(() => inboundBucketName("k".repeat(48), "ap-northeast-1")).toThrow(
      "too long"
    )
  })
})

describe("open and click tracking", () => {
  test("the tracking CNAME points to the installation and SES never tracks engagement", async () => {
    const f = await receivingWorld()
    const m = await member(f)
    await m.client.mutation(api.domains.update, {
      id: f.domain,
      trackingSubdomain: " Links ",
      openTracking: true,
      clickTracking: true,
    })
    await f.settle()
    let domain = await f.readDomain()
    expect(domain).toMatchObject({
      trackingSubdomain: "links",
      openTracking: true,
      clickTracking: true,
      phase: "ready",
      // As on Resend, the tracking record has its own status.
      status: "verified",
    })
    expect(domain.records.find((r) => r.kind === "Tracking")).toEqual({
      id: "tracking",
      kind: "Tracking",
      type: "CNAME",
      name: "links.mail.example.test",
      value: "api.opensend.test",
      ttl: "300",
      status: "pending",
    })
    const destinations = () =>
      f.ses
        .filter(
          (c) => c.name === "UpdateConfigurationSetEventDestinationCommand"
        )
        .map(
          (c) =>
            (c.input.EventDestination as { MatchingEventTypes: string[] })
              .MatchingEventTypes
        )
    // Links would break through a host that does not resolve yet.
    expect(destinations().at(-1)).not.toContain("OPEN")
    expect(
      f.ses.some((c) => c.name === "PutConfigurationSetTrackingOptionsCommand")
    ).toBe(false)
    f.zone.tracking = true
    await f.owner.client.mutation(api.domains.verify, { id: f.domain })
    await f.settle()
    domain = await f.readDomain()
    expect(domain.records.find((r) => r.kind === "Tracking")?.status).toBe(
      "verified"
    )
    expect(domain).toMatchObject({ status: "verified", phase: "ready" })
    expect(
      f.ses.some((c) => c.name === "PutConfigurationSetTrackingOptionsCommand")
    ).toBe(false)
    expect(destinations().at(-1)).toContain("DELIVERY")
    expect(destinations().at(-1)).not.toContain("OPEN")
    expect(destinations().at(-1)).not.toContain("CLICK")
    // Turning clicks off stops rewriting links; opens stay tracked.
    await f.owner.client.mutation(api.domains.update, {
      id: f.domain,
      clickTracking: false,
    })
    await f.settle()
    expect(destinations().at(-1)).not.toContain("OPEN")
    expect(destinations().at(-1)).not.toContain("CLICK")
  })

  test("tracking settings are validated and scoped to the team", async () => {
    const f = await receivingWorld()
    const update = (patch: Record<string, unknown>) =>
      f.owner.client.mutation(api.domains.update, { id: f.domain, ...patch })
    await expect(update({ trackingSubdomain: "not a label" })).rejects.toThrow(
      "one label"
    )
    await expect(update({ trackingSubdomain: "send" })).rejects.toThrow(
      "other than the Return-Path"
    )
    await expect(
      f.outsider.client.mutation(api.domains.update, {
        id: f.domain,
        openTracking: true,
        trackingSubdomain: "links",
      })
    ).rejects.toThrow("permission")
    expect((await f.readDomain()).trackingSubdomain).toBeUndefined()
  })
})

describe("REST domain tracking", () => {
  const call = (
    f: Fixture,
    token: string,
    path: string,
    init: RequestInit = {}
  ) =>
    f.t.fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    })
  test("PATCH sets Resend's tracking fields and GET reports them", async () => {
    vi.useFakeTimers()
    const f = await fixture()
    const { token } = await f.owner.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: { name: "Production", permission: "full_access", domainId: null },
    })
    const patch = (body: unknown) =>
      call(f, token, `/domains/${f.domain}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
    const refused = await patch({ open_tracking: "yes" })
    expect(refused.status).toBe(422)
    expect((await refused.json()).message).toContain("must be a boolean")
    const clash = await patch({ tracking_subdomain: "send" })
    expect(clash.status).toBe(422)
    const done = await patch({
      open_tracking: true,
      click_tracking: false,
      tracking_subdomain: "links",
    })
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ object: "domain", id: f.domain })
    const read = await (await call(f, token, `/domains/${f.domain}`)).json()
    expect(read).toMatchObject({
      open_tracking: true,
      click_tracking: false,
      tracking_subdomain: "links",
    })
  })
})

describe("inbound SNS notifications", () => {
  async function inboundWorld() {
    const f = await fixture()
    await storeTestCredentials(f)
    const inbound = await f.t.run((ctx) =>
      ctx.db.insert("inboundRegions", {
        region: "us-east-1",
        operation: "provision",
        phase: "ready",
        generation: 1,
        bucket: INBOUND_BUCKET,
        topicArn: INBOUND_TOPIC_ARN,
        callbackConfirmed: false,
        ruleSet: "rules",
      })
    )
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { receiving: true })
    )
    const fetcher = vi
      .spyOn(publicHttp, "publicFetch")
      .mockImplementation(async () => new Response(INBOUND_CERT_PEM))
    const stored = () =>
      f.t.run((ctx) => ctx.db.query("inboundMessages").take(10))
    const receive = (message: object) =>
      f.t.action(internal.ses.inbound.receive, {
        body: JSON.stringify(message),
      })
    return { ...f, inbound, fetcher, stored, receive }
  }

  test("a signed notification with an unowned object prefix is acknowledged without ingestion", async () => {
    const f = await inboundWorld()
    await f.receive(INBOUND_NOTIFICATION)
    await f.receive(INBOUND_NOTIFICATION)
    // This static signed fixture names "domain/", not the team's real id.
    // Authentic SNS does not authorize reading some other domain's object.
    expect(await f.stored()).toEqual([])
    // No domain of ours receives for this recipient.
    await f.receive(INBOUND_UNROUTED)
    expect(await f.stored()).toHaveLength(0)
  })

  test("forged, foreign and unrouted envelopes never enter the database", async () => {
    const f = await inboundWorld()
    await expect(
      f.receive({ ...INBOUND_NOTIFICATION, Message: "forged" })
    ).rejects.toThrow("signature")
    const before = f.fetcher.mock.calls.length
    await expect(
      f.receive({ ...INBOUND_NOTIFICATION, TopicArn: "foreign" })
    ).rejects.toThrow("Unknown")
    expect(f.fetcher.mock.calls).toHaveLength(before)
    // A domain that stopped receiving drops its mail.
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { receiving: false })
    )
    await f.receive(INBOUND_NOTIFICATION)
    expect(await f.stored()).toEqual([])
    // Over HTTP, a refused envelope stays retryable and echoes nothing.
    const response = await f.t.fetch("/ses/inbound", {
      method: "POST",
      body: JSON.stringify({ ...INBOUND_NOTIFICATION, Message: "forged" }),
    })
    expect(response.status).toBe(503)
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { receiving: true })
    )
    const accepted = await f.t.fetch("/ses/inbound", {
      method: "POST",
      body: JSON.stringify(INBOUND_NOTIFICATION),
    })
    expect(accepted.status).toBe(204)
    expect(await f.stored()).toHaveLength(0)
  })

  test("the subscription is confirmed through the API only for our endpoint", async () => {
    const f = await inboundWorld()
    let endpoint = "https://api.opensend.test/ses/events"
    const commands: string[] = []
    vi.spyOn(SNSClient.prototype, "send").mockImplementation(
      async (command) => {
        commands.push(command.constructor.name)
        if (command.constructor.name === "ConfirmSubscriptionCommand")
          return { SubscriptionArn: `${INBOUND_TOPIC_ARN}:sub` } as never
        return {
          Attributes: {
            Endpoint: endpoint,
            TopicArn: INBOUND_TOPIC_ARN,
            PendingConfirmation: "false",
          },
        } as never
      }
    )
    const confirmed = async () =>
      (await f.t.run((ctx) => ctx.db.get("inboundRegions", f.inbound)))!
        .callbackConfirmed
    await expect(f.receive(INBOUND_SUBSCRIPTION_CONFIRMATION)).rejects.toThrow(
      "Unexpected SNS subscription"
    )
    expect(await confirmed()).toBe(false)
    endpoint = "https://api.opensend.test/ses/inbound"
    await f.receive(INBOUND_SUBSCRIPTION_CONFIRMATION)
    expect(await confirmed()).toBe(true)
    expect(commands.slice(-2)).toEqual([
      "ConfirmSubscriptionCommand",
      "GetSubscriptionAttributesCommand",
    ])
  })
})
