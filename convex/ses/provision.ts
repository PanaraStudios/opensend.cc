"use node"
import { v, ConvexError } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import {
  getOwnedTenant,
  resourceAssociation,
  associateExclusive,
  disassociate,
} from "./tenantProvider"
import { controlPlanePacer } from "./pacing"
import { resourcePrefix } from "./contracts"
import {
  AdoptionConflict,
  assertOwned,
  awsError,
  connectionClients,
  mergePolicy,
  missing,
  readAccount,
} from "./aws"
import { identityFingerprint } from "./adoption"
import { checkRecords, identityRecords } from "./dns"
import {
  CreateTopicCommand,
  GetTopicAttributesCommand,
  ListTagsForResourceCommand as SnsTags,
  SetTopicAttributesCommand,
  SubscribeCommand,
  ListSubscriptionsByTopicCommand,
  SetSubscriptionAttributesCommand,
} from "@aws-sdk/client-sns"
import {
  CreateQueueCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  ListQueueTagsCommand,
  SetQueueAttributesCommand,
} from "@aws-sdk/client-sqs"
import {
  TagResourceCommand,
  UntagResourceCommand,
  PutEmailIdentityConfigurationSetAttributesCommand,
  CreateConfigurationSetCommand,
  GetConfigurationSetCommand,
  ListTagsForResourceCommand,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  PutConfigurationSetDeliveryOptionsCommand,
  CreateConfigurationSetEventDestinationCommand,
  UpdateConfigurationSetEventDestinationCommand,
  GetConfigurationSetEventDestinationsCommand,
  PutConfigurationSetSuppressionOptionsCommand,
  DeleteEmailIdentityCommand,
  DeleteConfigurationSetCommand,
  type GetEmailIdentityResponse,
  type SESv2Client,
} from "@aws-sdk/client-sesv2"

function applyTlsPolicy(
  ses: SESv2Client,
  configurationSet: string,
  tls: "enforced" | "opportunistic"
) {
  return ses.send(
    new PutConfigurationSetDeliveryOptionsCommand({
      ConfigurationSetName: configurationSet,
      TlsPolicy: tls === "enforced" ? "REQUIRE" : "OPTIONAL",
    })
  )
}

export const region = internalAction({
  args: { regionId: v.id("sesRegions") },
  returns: v.null(),
  handler: async (ctx, { regionId }) => {
    try {
      const installation = await ctx.runQuery(
        internal.installation.connection,
        {}
      )
      const region = await ctx.runQuery(internal.ses.state.region, {
        id: regionId,
      })
      const { ses, sns, sqs } = connectionClients(
        installation,
        region.region,
        controlPlanePacer(ctx, region.region)
      )
      const prefix = resourcePrefix(installation._id)
      const name = `${prefix}-events`
      const topicArn = `arn:aws:sns:${region.region}:${installation.accountId}:${name}`
      const tags = [{ Key: "opensend:installation", Value: installation._id }]
      let topic = await missing(() =>
        sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn }))
      )
      if (!topic) {
        await sns.send(new CreateTopicCommand({ Name: name, Tags: tags }))
        topic = await sns.send(
          new GetTopicAttributesCommand({ TopicArn: topicArn })
        )
      }
      assertOwned(
        (await sns.send(new SnsTags({ ResourceArn: topicArn }))).Tags,
        installation._id
      )
      await sns.send(
        new SetTopicAttributesCommand({
          TopicArn: topicArn,
          AttributeName: "SignatureVersion",
          AttributeValue: "2",
        })
      )
      await sns.send(
        new SetTopicAttributesCommand({
          TopicArn: topicArn,
          AttributeName: "Policy",
          AttributeValue: mergePolicy(topic.Attributes?.Policy, {
            Sid: "OpensendSesPublish",
            Effect: "Allow",
            Principal: { Service: "ses.amazonaws.com" },
            Action: "sns:Publish",
            Resource: topicArn,
            Condition: {
              StringEquals: { "AWS:SourceAccount": installation.accountId },
              ArnLike: {
                "AWS:SourceArn": `arn:aws:ses:${region.region}:${installation.accountId}:configuration-set/${prefix}-*`,
              },
            },
          }),
        })
      )
      let queue = await missing(() =>
        sqs.send(
          new GetQueueUrlCommand({
            QueueName: `${prefix}-events-dlq`,
            QueueOwnerAWSAccountId: installation.accountId,
          })
        )
      )
      if (!queue)
        queue = await sqs.send(
          new CreateQueueCommand({
            QueueName: `${prefix}-events-dlq`,
            tags: { "opensend:installation": installation._id },
            Attributes: {
              MessageRetentionPeriod: "1209600",
              SqsManagedSseEnabled: "true",
            },
          })
        )
      const QueueUrl = queue.QueueUrl!
      const queueTags = await sqs.send(new ListQueueTagsCommand({ QueueUrl }))
      assertOwned(
        Object.entries(queueTags.Tags ?? {}).map(([Key, Value]) => ({
          Key,
          Value,
        })),
        installation._id
      )
      const attributes = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl,
          AttributeNames: ["QueueArn", "Policy"],
        })
      )
      const queueArn = attributes.Attributes!.QueueArn!
      await sqs.send(
        new SetQueueAttributesCommand({
          QueueUrl,
          Attributes: {
            Policy: mergePolicy(attributes.Attributes?.Policy, {
              Sid: "OpensendSnsRedrive",
              Effect: "Allow",
              Principal: { Service: "sns.amazonaws.com" },
              Action: "sqs:SendMessage",
              Resource: queueArn,
              Condition: {
                ArnEquals: { "aws:SourceArn": topicArn },
                StringEquals: { "aws:SourceAccount": installation.accountId },
              },
            }),
          },
        })
      )
      // Persist the allowlist before subscribing: SNS can confirm immediately.
      await ctx.runMutation(internal.ses.state.patchRegion, {
        id: regionId,
        changes: { topicArn, queueArn },
      })
      const endpoint = `${installation.callbackOrigin}/ses/events`
      let subscriptionArn: string | undefined
      let token: string | undefined
      do {
        const page = await sns.send(
          new ListSubscriptionsByTopicCommand({
            TopicArn: topicArn,
            NextToken: token,
          })
        )
        subscriptionArn = page.Subscriptions?.find(
          (s) => s.Protocol === "https" && s.Endpoint === endpoint
        )?.SubscriptionArn
        token = page.NextToken
      } while (!subscriptionArn && token)
      const subscriptionAttributes = {
        RawMessageDelivery: "false",
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: queueArn }),
      }
      if (!subscriptionArn || subscriptionArn === "PendingConfirmation") {
        const result = await sns.send(
          new SubscribeCommand({
            TopicArn: topicArn,
            Protocol: "https",
            Endpoint: endpoint,
            ReturnSubscriptionArn: true,
            Attributes: subscriptionAttributes,
          })
        )
        subscriptionArn = result.SubscriptionArn
      } else {
        for (const [AttributeName, AttributeValue] of Object.entries(
          subscriptionAttributes
        ))
          await sns.send(
            new SetSubscriptionAttributesCommand({
              SubscriptionArn: subscriptionArn,
              AttributeName,
              AttributeValue,
            })
          )
      }
      await ctx.runMutation(internal.ses.state.patchRegion, {
        id: regionId,
        changes: {
          phase: "ready",
          ...(subscriptionArn && subscriptionArn !== "PendingConfirmation"
            ? { subscriptionArn }
            : {}),
          quota: await readAccount(ses),
          checkedAt: Date.now(),
        },
      })
    } catch (e) {
      await ctx.runMutation(internal.ses.state.patchRegion, {
        id: regionId,
        changes: { phase: "failed", error: awsError(e) },
      })
    }
    return null
  },
})

export const domain = internalAction({
  args: { domainId: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, { domainId }) => {
    let discoveredRecords: ReturnType<typeof identityRecords> | undefined
    try {
      const installation = await ctx.runQuery(
        internal.installation.connection,
        {}
      )
      const {
        domain,
        region,
        tenant: tenantRow,
      } = await ctx.runQuery(internal.domains.workerContext, { id: domainId })
      const { ses } = connectionClients(
        installation,
        domain.region,
        controlPlanePacer(ctx, domain.region)
      )
      if (
        domain.operation !== "remove" &&
        (!tenantRow ||
          tenantRow.deleted ||
          tenantRow.operation !== "provision" ||
          tenantRow.phase !== "ready")
      )
        throw new ConvexError(
          "This team's SES tenant is not ready. Retry tenant setup."
        )
      const tenant = tenantRow
        ? await getOwnedTenant(ses, installation, tenantRow)
        : null
      if (domain.operation !== "remove" && !tenant) {
        if (tenantRow)
          await ctx.runMutation(internal.tenants.observe, {
            id: tenantRow._id,
            generation: tenantRow.generation,
            error: "SES tenant is missing. Retry tenant setup.",
          })
        throw new ConvexError("SES tenant is missing. Retry tenant setup.")
      }
      if (tenant && tenantRow)
        await ctx.runMutation(internal.tenants.observe, {
          id: tenantRow._id,
          generation: tenantRow.generation,
          sendingStatus: tenant.SendingStatus ?? "UNKNOWN",
        })
      const prefix = resourcePrefix(installation._id)
      // Hash-sized document IDs keep SES configuration-set names below 64 chars.
      const configName = `${prefix}-${domain._id.slice(-12)}`
      const configArn = `arn:aws:ses:${domain.region}:${installation.accountId}:configuration-set/${configName}`
      if (domain.operation === "settings") {
        // Changing TLS never recreates identities, rewrites MAIL FROM, checks
        // DNS, or invalidates the tenant associations of a provisioned domain.
        await ses.send(
          new GetConfigurationSetCommand({ ConfigurationSetName: configName })
        )
        assertOwned(
          (
            await ses.send(
              new ListTagsForResourceCommand({ ResourceArn: configArn })
            )
          ).Tags,
          installation._id,
          domainId
        )
        if (!tenant) throw new ConvexError("SES tenant is not ready")
        await resourceAssociation(ses, tenant.TenantName, configArn)
        const tls = domain.pendingTls ?? domain.tls
        await applyTlsPolicy(ses, configName, tls)
        await ctx.runMutation(internal.domains.finish, {
          id: domainId,
          changes: { tls },
        })
        return null
      }
      const identityArn = `arn:aws:ses:${domain.region}:${installation.accountId}:identity/${domain.name}`
      const tags = [
        { Key: "opensend:installation", Value: installation._id },
        { Key: "opensend:domain", Value: domainId },
      ]
      const dnsRecords = (identity: GetEmailIdentityResponse) =>
        identityRecords(
          domain.name,
          domain.region,
          domain.customReturnPath,
          identity,
          domain.receiving
        )
      let identity = await missing(() =>
        ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain.name }))
      )
      // Only a provision may have no stored records yet. A failed refresh keeps
      // the ones its last successful run checked, instead of resetting them.
      if (
        identity?.DkimAttributes?.Tokens?.length &&
        identity.DkimAttributes.SigningHostedZone &&
        domain.operation === "provision"
      )
        discoveredRecords = dnsRecords(identity)
      if (identity && tenant && domain.operation !== "remove")
        await resourceAssociation(ses, tenant.TenantName, identityArn)
      let needsAdoption = false
      if (identity) {
        try {
          assertOwned(identity.Tags, installation._id, domainId)
        } catch {
          if (domain.operation === "remove") {
            /* Nothing here is ours: an approved adoption that never reached
               TagResource left no configuration of ours to restore. Abandon the
               claim rather than change or delete an unrelated identity — a
               drifted fingerprint must never block deleting the domain. */
            identity = null
          } else if (
            !domain.adoption?.approved ||
            identityFingerprint(identity) !== domain.adoption.fingerprint ||
            domain.operation !== "provision"
          )
            throw new AdoptionConflict(
              "This domain already exists in SES. Review the existing identity before connecting it to Opensend."
            )
          else needsAdoption = true
        }
      }
      let config = await missing(() =>
        ses.send(
          new GetConfigurationSetCommand({ ConfigurationSetName: configName })
        )
      )
      if (config)
        assertOwned(
          (
            await ses.send(
              new ListTagsForResourceCommand({ ResourceArn: configArn })
            )
          ).Tags,
          installation._id,
          domainId
        )
      if (domain.operation === "remove") {
        if (tenant) {
          if (identity) await disassociate(ses, tenant.TenantName, identityArn)
          if (config) await disassociate(ses, tenant.TenantName, configArn)
        }
        // An identity still held here is one we own; an unowned one was
        // abandoned above, so removal never restores or deletes it.
        if (identity && domain.adoption?.approved) {
          if (
            identity.ConfigurationSetName !== configName &&
            identity.ConfigurationSetName !== domain.adoption.configurationSet
          )
            throw new ConvexError(
              "AWS configuration changed outside Opensend. Review it before removal."
            )
          if (
            identity.MailFromAttributes?.MailFromDomain &&
            ![
              `${domain.customReturnPath}.${domain.name}`,
              domain.adoption.mailFromDomain,
            ].includes(identity.MailFromAttributes.MailFromDomain)
          )
            throw new ConvexError(
              "AWS MAIL FROM changed outside Opensend. Review it before removal."
            )
          await ses.send(
            new PutEmailIdentityConfigurationSetAttributesCommand({
              EmailIdentity: domain.name,
              ConfigurationSetName: domain.adoption.configurationSet,
            })
          )
          await ses.send(
            new PutEmailIdentityMailFromAttributesCommand({
              EmailIdentity: domain.name,
              MailFromDomain: domain.adoption.mailFromDomain,
              BehaviorOnMxFailure:
                domain.adoption.behaviorOnMxFailure === "REJECT_MESSAGE"
                  ? "REJECT_MESSAGE"
                  : "USE_DEFAULT_VALUE",
            })
          )
        } else if (identity)
          await ses.send(
            new DeleteEmailIdentityCommand({ EmailIdentity: domain.name })
          )
        if (config)
          await ses.send(
            new DeleteConfigurationSetCommand({
              ConfigurationSetName: configName,
            })
          )
        if (identity && domain.adoption?.approved)
          await ses.send(
            new UntagResourceCommand({
              ResourceArn: identityArn,
              TagKeys: ["opensend:installation", "opensend:domain"],
            })
          )
        await ctx.runMutation(internal.domains.finish, {
          id: domainId,
          changes: {
            deleted: true,
            sesVerified: false,
            status: "pending",
            tenantAssociated: false,
          },
        })
        return null
      }
      if (domain.operation === "provision") {
        if (!config) {
          await ses.send(
            new CreateConfigurationSetCommand({
              ConfigurationSetName: configName,
              Tags: tags,
              SuppressionOptions: {
                SuppressedReasons: ["BOUNCE", "COMPLAINT"],
              },
            })
          )
          config = await ses.send(
            new GetConfigurationSetCommand({ ConfigurationSetName: configName })
          )
          assertOwned(
            (
              await ses.send(
                new ListTagsForResourceCommand({ ResourceArn: configArn })
              )
            ).Tags,
            installation._id,
            domainId
          )
        }
        await ses.send(
          new PutConfigurationSetSuppressionOptionsCommand({
            ConfigurationSetName: configName,
            SuppressedReasons: ["BOUNCE", "COMPLAINT"],
          })
        )
        const destinations = await ses.send(
          new GetConfigurationSetEventDestinationsCommand({
            ConfigurationSetName: configName,
          })
        )
        const Destination = destinations.EventDestinations?.some(
          (d) => d.Name === "opensend-events"
        )
          ? UpdateConfigurationSetEventDestinationCommand
          : CreateConfigurationSetEventDestinationCommand
        await ses.send(
          new Destination({
            ConfigurationSetName: configName,
            EventDestinationName: "opensend-events",
            EventDestination: {
              Enabled: true,
              MatchingEventTypes: [
                "SEND",
                "REJECT",
                "BOUNCE",
                "COMPLAINT",
                "DELIVERY",
                "RENDERING_FAILURE",
                "DELIVERY_DELAY",
              ],
              SnsDestination: { TopicArn: region.topicArn },
            },
          })
        )
        if (!identity) {
          await ses.send(
            new CreateEmailIdentityCommand({
              EmailIdentity: domain.name,
              ConfigurationSetName: configName,
              Tags: tags,
              DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
            })
          )
          identity = await ses.send(
            new GetEmailIdentityCommand({ EmailIdentity: domain.name })
          )
          assertOwned(identity.Tags, installation._id, domainId)
        }
        discoveredRecords = dnsRecords(identity)
        if (needsAdoption)
          await ses.send(
            new TagResourceCommand({ ResourceArn: identityArn, Tags: tags })
          )
        if (identity.ConfigurationSetName !== configName)
          await ses.send(
            new PutEmailIdentityConfigurationSetAttributesCommand({
              EmailIdentity: domain.name,
              ConfigurationSetName: configName,
            })
          )
        await ses.send(
          new PutEmailIdentityMailFromAttributesCommand({
            EmailIdentity: domain.name,
            MailFromDomain: `${domain.customReturnPath}.${domain.name}`,
            BehaviorOnMxFailure: "REJECT_MESSAGE",
          })
        )
      }
      if (!identity || !config)
        throw new Error("AWS identity or configuration set is missing")
      // A refresh queued alongside a TLS change still applies the pending
      // policy, so one operation can rebuild records and settle TLS together.
      const tlsPolicy = domain.pendingTls ?? domain.tls
      if (domain.operation === "provision" || domain.pendingTls)
        await applyTlsPolicy(ses, configName, tlsPolicy)
      if (!tenant) throw new ConvexError("SES tenant is not ready")
      await associateExclusive(ses, tenant.TenantName, identityArn)
      await associateExclusive(ses, tenant.TenantName, configArn)
      // Only a provision rewrites the identity, so a refresh reads it once.
      if (domain.operation === "provision")
        identity = await ses.send(
          new GetEmailIdentityCommand({ EmailIdentity: domain.name })
        )
      const records = await checkRecords(dnsRecords(identity))
      const sesVerified = !!identity.VerifiedForSendingStatus
      const dkimVerified =
        identity.DkimAttributes?.Status === "SUCCESS" &&
        !!identity.DkimAttributes.SigningEnabled
      const mailFromVerified =
        identity.MailFromAttributes?.MailFromDomainStatus === "SUCCESS" &&
        identity.MailFromAttributes.MailFromDomain ===
          `${domain.customReturnPath}.${domain.name}` &&
        identity.MailFromAttributes.BehaviorOnMxFailure === "REJECT_MESSAGE"
      /* DMARC is advisory, so it never holds a domain back from verified, and
         a resolver that timed out proves nothing: only a record the resolver
         positively did not find keeps a domain partially verified. */
      const allVerified =
        sesVerified &&
        dkimVerified &&
        mailFromVerified &&
        records.every((r) => r.kind === "DMARC" || r.status !== "pending")
      await ctx.runMutation(internal.domains.finish, {
        id: domainId,
        changes: {
          records,
          tls: tlsPolicy,
          configurationSet: configName,
          tenantAssociated: true,
          sesVerified,
          dkimVerified,
          mailFromVerified,
          status: allVerified
            ? "verified"
            : sesVerified
              ? "partially_verified"
              : "pending",
        },
      })
      await ctx.runMutation(internal.ses.state.patchRegion, {
        id: region._id,
        changes: { quota: await readAccount(ses), checkedAt: Date.now() },
      })
    } catch (e) {
      await ctx.runMutation(internal.domains.finish, {
        id: domainId,
        changes: discoveredRecords ? { records: discoveredRecords } : {},
        error: awsError(e),
        needsAdoptionReview: e instanceof AdoptionConflict ? true : undefined,
      })
    }
    return null
  },
})
