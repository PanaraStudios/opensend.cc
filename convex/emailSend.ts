"use node"
import {
  DeleteSuppressedDestinationCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2"
import { v, ConvexError } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { awsError, connectionClients, missing } from "./ses/aws"
import { sesMailbox } from "../lib/dashboard/email-send"

/** Throttling, a server-side failure or no answer at all: worth another
    try later. SES's 4xx rejections (MessageRejected, an unverified
    sender, a paused tenant…) are final. */
function retryable(error: unknown) {
  if (error instanceof ConvexError) return false
  const name = error instanceof Error ? error.name : ""
  const status = (error as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode
  if (/Throttl|TooManyRequests/.test(name)) return true
  return status === undefined || status >= 500
}

/** One run of the sender: claim, send through the team's SES tenant,
    record. A run whose email changed since it was queued does nothing. */
export const deliver = internalAction({
  args: { id: v.id("emails"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const message = await ctx.runMutation(internal.emails.claim, args)
    if (!message) return null
    let outcome:
      | { kind: "sent"; messageId: string }
      | { kind: "failed"; error: string; retryable: boolean }
    try {
      const attachments = await Promise.all(
        message.attachments.map(async (attachment) => {
          const blob = await ctx.storage.get(attachment.storageId)
          if (!blob) throw new ConvexError("An attachment is missing")
          return {
            RawContent: new Uint8Array(await blob.arrayBuffer()),
            FileName: attachment.filename,
            ContentType: attachment.contentType,
            ...(attachment.contentId
              ? {
                  ContentId: attachment.contentId,
                  ContentDisposition: "INLINE" as const,
                }
              : { ContentDisposition: "ATTACHMENT" as const }),
            ContentTransferEncoding: "BASE64" as const,
          }
        })
      )
      const installation = await ctx.runQuery(
        internal.installation.connection,
        {}
      )
      const { ses } = connectionClients(installation, message.region)
      const utf8 = (Data: string) => ({ Data, Charset: "UTF-8" })
      const result = await ses.send(
        new SendEmailCommand({
          FromEmailAddress: sesMailbox(message.from),
          Destination: {
            ToAddresses: message.to.map(sesMailbox),
            CcAddresses: message.cc.map(sesMailbox),
            BccAddresses: message.bcc.map(sesMailbox),
          },
          ReplyToAddresses: message.replyTo.map(sesMailbox),
          Content: {
            Simple: {
              Subject: utf8(message.subject),
              Body: {
                ...(message.html ? { Html: utf8(message.html) } : {}),
                ...(message.text ? { Text: utf8(message.text) } : {}),
              },
              ...(message.headers.length
                ? {
                    Headers: message.headers.map(({ name, value }) => ({
                      Name: name,
                      Value: value,
                    })),
                  }
                : {}),
              ...(attachments.length ? { Attachments: attachments } : {}),
            },
          },
          EmailTags: message.tags.map(({ name, value }) => ({
            Name: name,
            Value: value,
          })),
          // Never sent without both: IAM and SES tenancy require them.
          ConfigurationSetName: message.ConfigurationSetName,
          TenantName: message.TenantName,
        })
      )
      outcome = { kind: "sent", messageId: result.MessageId ?? "" }
    } catch (error) {
      outcome = {
        kind: "failed",
        error: awsError(error),
        retryable: retryable(error),
      }
    }
    await ctx.runMutation(internal.emails.record, { ...args, outcome })
    return null
  },
})

/** Clears a removed bounce or complaint from each of the team's tenant
    suppression lists, where SES put it. */
export const releaseSuppression = internalAction({
  args: { organizationId: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { organizationId, email }): Promise<null> => {
    const tenants = await ctx.runQuery(internal.suppressions.tenants, {
      organizationId,
    })
    if (!tenants.length) return null
    const installation = await ctx.runQuery(
      internal.installation.connection,
      {}
    )
    for (const tenant of tenants)
      try {
        const { ses } = connectionClients(installation, tenant.region)
        await missing(() =>
          ses.send(
            new DeleteSuppressedDestinationCommand({
              EmailAddress: email,
              TenantName: tenant.name,
            })
          )
        )
      } catch (error) {
        console.error(`Suppression release failed: ${awsError(error)}`)
      }
    return null
  },
})
