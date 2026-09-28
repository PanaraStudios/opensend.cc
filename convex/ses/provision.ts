"use node"
import { trackingTarget } from "./contracts"
import { v, ConvexError } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import {
  getOwnedTenant,
  resourceAssociation,
  associateExclusive,
  disassociate,
} from "./tenantProvider"
import { pacedConnection } from "./pacing"
import { resourcePrefix, tenantProvisioned } from "./contracts"
import {
  AdoptionConflict,
  assertOwned,
  awsError,
  mergePolicy,
  missing,
  readAccount,
} from "./aws"
import { identityFingerprint } from "./adoption"
import { verificationState } from "./dns"
import { identityRecords } from "./records"
import { ensureSubscription, ensureTopic } from "./topics"
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
  type SESv2Client,
} from "@aws-sdk/client-sesv2"
import { removeReceiptRule, syncReceiptRule } from "./inbound"

const tlsPolicyValue = (tls: "enforced" | "opportunistic") =>
  tls === "enforced" ? "REQUIRE" : "OPTIONAL"
function applyTlsPolicy(
  ses: SESv2Client,
  configurationSet: string,
  tls: "enforced" | "opportunistic"
) {
  return ses.send(
    new PutConfigurationSetDeliveryOptionsCommand({
      ConfigurationSetName: configurationSet,
      TlsPolicy: tlsPolicyValue(tls),
    })
  )
}

/** Always remove SES engagement event types, including on existing sets. */
async function applyEventDestination(
  ses: SESv2Client,
  configName: string,
  topicArn: string | undefined,
  created = false
) {
  const destinations = created
    ? undefined
    : await ses.send(
        new GetConfigurationSetEventDestinationsCommand({
          ConfigurationSetName: configName,
        })
      )
  const Destination = destinations?.EventDestinations?.some(
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
        SnsDestination: { TopicArn: topicArn },
      },
    })
  )
}

export const region = internalAction({
  args: { regionId: v.id("sesRegions") },
  returns: v.null(),
  handler: async (ctx, { regionId }) => {
    try {
      const region = await ctx.runQuery(internal.ses.state.region, {
        id: regionId,
      })
      const { installation, ses, sns, sqs } = await pacedConnection(
        ctx,
        region.region
      )
      const prefix = resourcePrefix(installation._id)
      const topicArn = await ensureTopic(
        sns,
        installation,
        region.region,
        `${prefix}-events`,
        {
          Sid: "OpensendSesPublish",
          SourceArn: `arn:aws:ses:${region.region}:${installation.accountId}:configuration-set/${prefix}-*`,
        }
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
      const subscriptionArn = await ensureSubscription(
        sns,
        topicArn,
        `${installation.callbackOrigin}/ses/events`,
        {
          RawMessageDelivery: "false",
          RedrivePolicy: JSON.stringify({ deadLetterTargetArn: queueArn }),
        }
      )
      await ctx.runMutation(internal.ses.state.patchRegion, {
        id: regionId,
        changes: {
          phase: "ready",
          ...(subscriptionArn ? { subscriptionArn } : {}),
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
      const {
        domain,
        region,
        tenant: tenantRow,
        inbound,
      } = await ctx.runQuery(internal.domains.workerContext, { id: domainId })
      const { installation, ses, sesClassic } = await pacedConnection(
        ctx,
        domain.region
      )
      if (
        domain.operation !== "remove" &&
        (!tenantRow || !tenantProvisioned(tenantRow))
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
      const assertConfigOwned = async () =>
        assertOwned(
          (
            await ses.send(
              new ListTagsForResourceCommand({ ResourceArn: configArn })
            )
          ).Tags,
          installation._id,
          domainId
        )
      const mailFromDomain = `${domain.customReturnPath}.${domain.name}`
      if (domain.operation === "settings") {
        // Changing TLS never recreates identities, rewrites MAIL FROM, checks
        // DNS, or invalidates the tenant associations of a provisioned domain.
        // Reading the set's tags also proves it exists.
        await assertConfigOwned()
        if (!tenant) throw new ConvexError("SES tenant is not ready")
        await resourceAssociation(ses, tenant.TenantName, configArn)
        const tls = domain.pendingTls ?? domain.tls
        await applyTlsPolicy(ses, configName, tls)
        await applyEventDestination(ses, configName, region.topicArn)
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
        discoveredRecords = identityRecords(
          {
            ...domain,
            trackingTarget: trackingTarget(installation.callbackOrigin),
          },
          identity
        )
      // Checked early so a foreign association fails before anything changes.
      const identityAssociated =
        identity && tenant && domain.operation !== "remove"
          ? await resourceAssociation(ses, tenant.TenantName, identityArn)
          : false
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
      let config = !!(await missing(() =>
        ses.send(
          new GetConfigurationSetCommand({ ConfigurationSetName: configName })
        )
      ))
      if (config) await assertConfigOwned()
      if (domain.operation === "remove") {
        await removeReceiptRule(sesClassic, installation, domain, inbound)
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
            ![mailFromDomain, domain.adoption.mailFromDomain].includes(
              identity.MailFromAttributes.MailFromDomain
            )
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
          receiptRuleSet: null,
        })
        return null
      }
      // A refresh queued alongside a TLS change still applies the pending
      // policy, so one operation can rebuild records and settle TLS together.
      const tlsPolicy = domain.pendingTls ?? domain.tls
      /* Every SES management call waits its turn in the region's ~1/s pacer,
         so a provision issues the identity, and publishes its records, before
         the rest of the setup. A set created here already carries the
         suppression and TLS settings and has no event destinations yet. */
      let createdConfig = false
      if (domain.operation === "provision") {
        if (!config) {
          await ses.send(
            new CreateConfigurationSetCommand({
              ConfigurationSetName: configName,
              Tags: tags,
              SuppressionOptions: {
                SuppressedReasons: ["BOUNCE", "COMPLAINT"],
              },
              DeliveryOptions: { TlsPolicy: tlsPolicyValue(tlsPolicy) },
            })
          )
          // Reading the new set's tags also proves it now exists.
          await assertConfigOwned()
          config = true
          createdConfig = true
        }
        if (!identity) {
          const created = await ses.send(
            new CreateEmailIdentityCommand({
              EmailIdentity: domain.name,
              ConfigurationSetName: configName,
              Tags: tags,
              DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
            })
          )
          if (
            created.DkimAttributes?.Tokens?.length &&
            created.DkimAttributes.SigningHostedZone
          ) {
            discoveredRecords = identityRecords(
              {
                ...domain,
                trackingTarget: trackingTarget(installation.callbackOrigin),
              },
              created
            )
            await ctx.runMutation(internal.domains.saveRecords, {
              id: domainId,
              records: discoveredRecords,
            })
          }
          identity = await ses.send(
            new GetEmailIdentityCommand({ EmailIdentity: domain.name })
          )
          assertOwned(identity.Tags, installation._id, domainId)
        }
        discoveredRecords = identityRecords(
          {
            ...domain,
            trackingTarget: trackingTarget(installation.callbackOrigin),
          },
          identity
        )
        if (!createdConfig)
          await ses.send(
            new PutConfigurationSetSuppressionOptionsCommand({
              ConfigurationSetName: configName,
              SuppressedReasons: ["BOUNCE", "COMPLAINT"],
            })
          )
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
            MailFromDomain: mailFromDomain,
            BehaviorOnMxFailure: "REJECT_MESSAGE",
          })
        )
      }
      if (!identity || !config)
        throw new Error("AWS identity or configuration set is missing")
      if (
        !createdConfig &&
        (domain.operation === "provision" || domain.pendingTls)
      )
        await applyTlsPolicy(ses, configName, tlsPolicy)
      if (!tenant) throw new ConvexError("SES tenant is not ready")
      if (!identityAssociated)
        await associateExclusive(ses, tenant.TenantName, identityArn)
      await associateExclusive(ses, tenant.TenantName, configArn)
      // Only a provision rewrites the identity, so a refresh reads it once.
      if (domain.operation === "provision")
        identity = await ses.send(
          new GetEmailIdentityCommand({ EmailIdentity: domain.name })
        )
      const state = await verificationState(
        identity,
        domain,
        installation.callbackOrigin
      )
      await applyEventDestination(
        ses,
        configName,
        region.topicArn,
        createdConfig
      )
      const receiptRuleSet = await syncReceiptRule(
        ctx,
        sesClassic,
        installation,
        domain,
        inbound
      )
      await ctx.runMutation(internal.domains.finish, {
        id: domainId,
        changes: {
          ...state,
          trackingTarget: trackingTarget(installation.callbackOrigin),
          tls: tlsPolicy,
          configurationSet: configName,
          tenantAssociated: true,
        },
        receiptRuleSet,
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
