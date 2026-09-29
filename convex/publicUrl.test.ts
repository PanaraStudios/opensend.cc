import * as publicHttp from "../lib/net/public-fetch"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { Resolver } from "node:dns/promises"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { SNSClient } from "@aws-sdk/client-sns"
import { SQSClient } from "@aws-sdk/client-sqs"
import { api } from "./_generated/api"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { mockInboundAws } from "./testHelpers/inboundAws.fixture"
import { patchRow } from "./counts"
import { setupProof } from "./ses/web"
import { inboundBucketName, resourcePrefix } from "./ses/contracts"

const OLD = "https://api.opensend.test"
const NEW = "https://events.opensend.test"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "public-url-test-secret")
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A connected installation whose region, inbound mail and one domain are
    provisioned for the old public URL, with AWS and DNS in memory. `probe`
    decides how the new URL answers the reachability check. */
async function world() {
  const f = await fixture()
  await storeTestCredentials(f)
  const prefix = resourcePrefix(f.installation)
  const eventsTopic = `arn:aws:sns:us-east-1:123456789012:${prefix}-events`
  const inboundTopic = `arn:aws:sns:us-east-1:123456789012:${prefix}-inbound`
  const tags = [
    { Key: "opensend:installation", Value: f.installation },
    { Key: "opensend:domain", Value: f.domain },
  ]
  await f.t.run(async (ctx) => {
    await ctx.db.patch("sesRegions", f.region._id, {
      topicArn: eventsTopic,
      subscriptionArn: `${eventsTopic}:old`,
      callbackConfirmed: true,
    })
    await patchRow(ctx, "domains", f.domain, {
      trackingSubdomain: "links",
      clickTracking: true,
      trackingTarget: "api.opensend.test",
      tenantAssociated: true,
      configurationSet: `${prefix}-${f.domain.slice(-12)}`,
    })
    await ctx.db.insert("inboundRegions", {
      region: "us-east-1",
      operation: "provision",
      phase: "ready",
      generation: 1,
      bucket: inboundBucketName(f.installation, "us-east-1"),
      topicArn: inboundTopic,
      subscriptionArn: `${inboundTopic}:old`,
      callbackConfirmed: true,
      ruleSet: `${prefix}-inbound`,
      ownsRuleSet: true,
    })
  })
  vi.spyOn(Resolver.prototype, "resolveNs").mockResolvedValue([])
  vi.spyOn(Resolver.prototype, "resolveCname").mockResolvedValue([])
  vi.spyOn(Resolver.prototype, "resolveMx").mockResolvedValue([])
  vi.spyOn(Resolver.prototype, "resolveTxt").mockResolvedValue([])
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
    async (command) => {
      const name = command.constructor.name
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
          Tags: tags,
          DkimAttributes: {
            Tokens: ["provider-token"],
            SigningHostedZone: "regional.dkim.amazonses.com",
            Status: "PENDING",
            SigningEnabled: true,
          },
        } as never
      if (name === "ListTagsForResourceCommand") return { Tags: tags } as never
      if (name === "GetConfigurationSetEventDestinationsCommand")
        return { EventDestinations: [{ Name: "opensend-events" }] } as never
      if (name === "GetAccountCommand")
        return { SendQuota: { Max24HourSend: 200, MaxSendRate: 1 } } as never
      return {} as never
    }
  )
  // S3 and the classic SES receipt rules, for the inbound setup.
  const inbound = mockInboundAws(f.installation)
  inbound.state.bucket = true
  inbound.state.bucketTags = [
    { Key: "opensend:installation", Value: f.installation },
  ]
  inbound.state.sets.set(`${prefix}-inbound`, [])
  inbound.state.active = `${prefix}-inbound`
  /* Both topics exist, each subscribed to the old URL only. */
  const subscriptions = new Map<string, Map<string, string>>([
    [eventsTopic, new Map([[`${OLD}/ses/events`, `${eventsTopic}:old`]])],
    [inboundTopic, new Map([[`${OLD}/ses/inbound`, `${inboundTopic}:old`]])],
  ])
  const sns: { name: string; input: Record<string, unknown> }[] = []
  vi.spyOn(SNSClient.prototype, "send").mockImplementation(async (command) => {
    const name = command.constructor.name
    const input = command.input as Record<string, unknown>
    sns.push({ name, input })
    const topic = subscriptions.get(input.TopicArn as string)
    if (name === "GetTopicAttributesCommand")
      return {
        Attributes: {
          Policy: JSON.stringify({ Version: "2012-10-17", Statement: [] }),
        },
      } as never
    if (name === "ListTagsForResourceCommand")
      return {
        Tags: [{ Key: "opensend:installation", Value: f.installation }],
      } as never
    if (name === "ListSubscriptionsByTopicCommand")
      return {
        Subscriptions: [...(topic ?? [])].map(([Endpoint, arn]) => ({
          Protocol: "https",
          Endpoint,
          SubscriptionArn: arn,
        })),
      } as never
    if (name === "SubscribeCommand") {
      const arn = `${input.TopicArn}:new`
      topic!.set(input.Endpoint as string, arn)
      return { SubscriptionArn: arn } as never
    }
    return {} as never
  })
  vi.spyOn(SQSClient.prototype, "send").mockImplementation(async (command) => {
    const name = command.constructor.name
    if (name === "GetQueueUrlCommand")
      return {
        QueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/dlq",
      } as never
    if (name === "ListQueueTagsCommand")
      return { Tags: { "opensend:installation": f.installation } } as never
    if (name === "GetQueueAttributesCommand")
      return {
        Attributes: { QueueArn: "arn:aws:sqs:us-east-1:123456789012:dlq" },
      } as never
    return {} as never
  })
  /** How the new URL answers: this deployment, another one, or nothing. */
  const probe = { answer: "ours" as "ours" | "foreign" | "down" }
  const fetcher = vi
    .spyOn(publicHttp, "publicFetch")
    .mockImplementation(async (url) => {
      if (probe.answer === "down") throw new TypeError("fetch failed")
      const challenge = new URL(String(url)).searchParams.get("challenge")!
      return Response.json({
        challenge,
        proof:
          probe.answer === "ours" ? await setupProof(challenge) : "someone",
      })
    })
  const settle = () =>
    f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  const read = () =>
    f.t.run(async (ctx) => ({
      installation: (await ctx.db
        .query("installation")
        .withIndex("by_key", (q) => q.eq("key", "installation"))
        .unique())!,
      region: (await ctx.db.get("sesRegions", f.region._id))!,
      inbound: (await ctx.db.query("inboundRegions").first())!,
      domain: (await ctx.db.get("domains", f.domain))!,
    }))
  const change = (callbackOrigin: string, client = f.owner.client) =>
    client.action(api.installationActions.changeCallbackOrigin, {
      callbackOrigin,
    })
  return {
    ...f,
    eventsTopic,
    inboundTopic,
    sns,
    probe,
    fetcher,
    settle,
    read,
    change,
  }
}

describe("changing the public URL", () => {
  test("only the installation administrator can change it", async () => {
    const f = await world()
    await expect(f.change(NEW, f.outsider.client)).rejects.toThrow(
      "installation administrator"
    )
    expect(f.fetcher).not.toHaveBeenCalled()
    expect((await f.read()).installation.callbackOrigin).toBe(OLD)
  })

  test("an invalid or unchanged URL is refused before it is checked", async () => {
    const f = await world()
    await expect(f.change("http://events.opensend.test")).rejects.toThrow(
      "HTTPS"
    )
    await expect(f.change(`${NEW}/ses`)).rejects.toThrow("path")
    await expect(f.change("https://events.opensend.test:8443")).rejects.toThrow(
      "without a port"
    )
    await expect(f.change("not a url")).rejects.toThrow()
    await expect(f.change(`${OLD}/`)).rejects.toThrow("already the public URL")
    expect(f.fetcher).not.toHaveBeenCalled()
    expect((await f.read()).installation.callbackOrigin).toBe(OLD)
  })

  test("a URL that does not reach this deployment leaves everything unchanged", async () => {
    const f = await world()
    const before = await f.read()
    f.probe.answer = "foreign"
    await expect(f.change(NEW)).rejects.toThrow(
      "did not reach this Opensend deployment"
    )
    f.probe.answer = "down"
    await expect(f.change(NEW)).rejects.toThrow("Could not reach")
    await f.settle()
    const after = await f.read()
    expect(after.installation.callbackOrigin).toBe(OLD)
    expect(after.region).toEqual(before.region)
    expect(after.inbound).toEqual(before.inbound)
    expect(after.domain.phase).toBe("ready")
    expect(f.sns).toHaveLength(0)
  })

  test("is refused while a region, inbound or domain operation runs", async () => {
    const f = await world()
    const refused = "Wait for running AWS and domain setup to finish"
    await f.t.run((ctx) =>
      patchRow(ctx, "domains", f.domain, { phase: "running" })
    )
    await expect(f.change(NEW)).rejects.toThrow(refused)
    await f.t.run(async (ctx) => {
      await patchRow(ctx, "domains", f.domain, { phase: "ready" })
      await ctx.db.patch("sesRegions", f.region._id, { phase: "running" })
    })
    await expect(f.change(NEW)).rejects.toThrow(refused)
    await f.t.run(async (ctx) => {
      await ctx.db.patch("sesRegions", f.region._id, { phase: "ready" })
      const inbound = (await ctx.db.query("inboundRegions").first())!
      await ctx.db.patch("inboundRegions", inbound._id, { phase: "running" })
    })
    await expect(f.change(NEW)).rejects.toThrow(refused)
    expect(f.fetcher).not.toHaveBeenCalled()
    expect((await f.read()).installation.callbackOrigin).toBe(OLD)
  })

  test("subscribes the new URL in every region, then refreshes every domain", async () => {
    const f = await world()
    await f.change(`${NEW}/`)
    // Saved at once; the region shows as setting up, its callback unconfirmed.
    const started = await f.read()
    expect(started.installation.callbackOrigin).toBe(NEW)
    expect(started.region).toMatchObject({
      phase: "running",
      callbackConfirmed: false,
    })
    expect(started.region.subscriptionArn).toBeUndefined()
    const status = await f.owner.client.query(api.installation.status)
    expect(status.regions[0]).toMatchObject({
      phase: "running",
      callbackConfirmed: false,
    })
    // A second change waits for this one.
    await expect(f.change("https://other.opensend.test")).rejects.toThrow(
      "Wait for running"
    )

    await f.settle()
    const done = await f.read()
    const subscribed = f.sns
      .filter((call) => call.name === "SubscribeCommand")
      .map((call) => [call.input.TopicArn, call.input.Endpoint])
    expect(subscribed).toEqual(
      expect.arrayContaining([
        [f.eventsTopic, `${NEW}/ses/events`],
        [f.inboundTopic, `${NEW}/ses/inbound`],
      ])
    )
    expect(subscribed).toHaveLength(2)
    // The policy grants no sns:Unsubscribe; the old subscriptions stay.
    expect(f.sns.map((call) => call.name)).not.toContain("UnsubscribeCommand")
    // Unconfirmed until SNS confirms the new subscription, as in first setup.
    expect(done.region).toMatchObject({
      phase: "ready",
      callbackConfirmed: false,
      subscriptionArn: `${f.eventsTopic}:new`,
    })
    expect(done.region.error).toBeUndefined()
    expect(done.inbound).toMatchObject({
      operation: "provision",
      phase: "ready",
      generation: 2,
      callbackConfirmed: false,
      subscriptionArn: `${f.inboundTopic}:new`,
    })
    // The domain refreshed, and its tracking record follows the new URL.
    expect(done.domain).toMatchObject({
      phase: "ready",
      operation: "refresh",
      trackingTarget: "events.opensend.test",
    })
    expect(done.domain.error).toBeUndefined()
    expect(
      done.domain.records.find((record) => record.kind === "Tracking")
    ).toMatchObject({
      name: "links.mail.example.test",
      value: "events.opensend.test",
    })
  })
})
