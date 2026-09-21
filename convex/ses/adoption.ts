"use node"
import { createHash } from "node:crypto"
import {
  GetEmailIdentityCommand,
  type GetEmailIdentityResponse,
} from "@aws-sdk/client-sesv2"
import { v, ConvexError } from "convex/values"
import { action } from "../_generated/server"
import { internal } from "../_generated/api"
import { controlPlanePacer } from "./pacing"
import { resourceAssociation } from "./tenantProvider"
import { teamTenantName } from "./contracts"
import { connectionClients, awsError } from "./aws"

export function identityFingerprint(identity: GetEmailIdentityResponse) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        configurationSet: identity.ConfigurationSetName ?? null,
        mailFrom: {
          domain: identity.MailFromAttributes?.MailFromDomain ?? null,
          behavior:
            identity.MailFromAttributes?.BehaviorOnMxFailure ??
            "USE_DEFAULT_VALUE",
        },
        dkimOrigin: identity.DkimAttributes?.SigningAttributesOrigin ?? null,
        tags: [...(identity.Tags ?? [])].sort((a, b) =>
          (a.Key ?? "").localeCompare(b.Key ?? "")
        ),
      })
    )
    .digest("hex")
}
export const preview = action({
  args: { id: v.id("domains") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const domain = await ctx.runQuery(internal.domains.previewContext, args)
    const installation = await ctx.runQuery(
      internal.installation.connection,
      {}
    )
    try {
      const { ses } = connectionClients(
        installation,
        domain.region,
        controlPlanePacer(ctx, domain.region)
      )
      const identity = await ses.send(
        new GetEmailIdentityCommand({ EmailIdentity: domain.name })
      )
      if (identity.Tags?.some((t) => t.Key?.startsWith("opensend:")))
        throw new ConvexError(
          "This identity is already claimed by an Opensend installation. Resolve ownership before adopting it."
        )
      if (
        !identity.DkimAttributes?.Tokens?.length ||
        !identity.DkimAttributes.SigningHostedZone
      )
        throw new ConvexError("Only identities using Easy DKIM can be adopted")
      await resourceAssociation(
        ses,
        teamTenantName(installation._id, domain.organizationId),
        `arn:aws:ses:${domain.region}:${installation.accountId}:identity/${domain.name}`
      )
      await ctx.runMutation(internal.domains.savePreview, {
        id: args.id,
        adoption: {
          fingerprint: identityFingerprint(identity),
          approved: false,
          configurationSet: identity.ConfigurationSetName,
          mailFromDomain: identity.MailFromAttributes?.MailFromDomain,
          behaviorOnMxFailure: identity.MailFromAttributes?.BehaviorOnMxFailure,
        },
      })
      return null
    } catch (e) {
      throw new ConvexError(awsError(e))
    }
  },
})
