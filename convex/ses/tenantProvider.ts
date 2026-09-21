"use node"
import { ConvexError } from "convex/values"
import {
  CreateTenantCommand,
  GetTenantCommand,
  PutTenantSuppressionAttributesCommand,
  CreateTenantResourceAssociationCommand,
  DeleteTenantResourceAssociationCommand,
  ListResourceTenantsCommand,
  ListTenantResourcesCommand,
  DeleteTenantCommand,
  type SESv2Client,
  type Tenant,
} from "@aws-sdk/client-sesv2"
import type { Doc } from "../_generated/dataModel"
import { assertOwned, missing } from "./aws"

function assertTenantOwned(
  tenant: Tenant | undefined,
  installation: Doc<"installation">,
  row: Doc<"sesTenants">
) {
  if (
    !tenant?.TenantArn ||
    !tenant.TenantId ||
    tenant.TenantName !== row.name ||
    !tenant.TenantArn.startsWith(
      `arn:aws:ses:${row.region}:${installation.accountId}:tenant/`
    )
  )
    throw new ConvexError("AWS returned an unexpected SES tenant")
  assertOwned(tenant.Tags, installation._id)
  if (
    !tenant.Tags?.some(
      (tag) => tag.Key === "opensend:team" && tag.Value === row.organizationId
    )
  )
    throw new ConvexError("This SES tenant belongs to another team")
  return tenant as Tenant & {
    TenantArn: string
    TenantId: string
    TenantName: string
  }
}
export async function getOwnedTenant(
  ses: SESv2Client,
  installation: Doc<"installation">,
  row: Doc<"sesTenants">
) {
  const response = await missing(() =>
    ses.send(new GetTenantCommand({ TenantName: row.name }))
  )
  return response ? assertTenantOwned(response.Tenant, installation, row) : null
}
/** Bounces and complaints are held on the tenant, not the whole account. */
const suppressed = (tenant: Tenant) =>
  tenant.SuppressionAttributes?.SuppressionScope === "TENANT" &&
  (["BOUNCE", "COMPLAINT"] as const).every((reason) =>
    tenant.SuppressionAttributes?.SuppressedReasons?.includes(reason)
  )

export async function provisionTenant(
  ses: SESv2Client,
  installation: Doc<"installation">,
  row: Doc<"sesTenants">
) {
  // Before a tenant exists, SES evaluates GetTenant against Resource "*".
  // Start with CreateTenant for a new/unacknowledged tenant so scoped read
  // permissions suffice. A retry may return AlreadyExists; ownership is checked
  // below before changing suppression or associating any resources.
  let tenant = row.arn ? await getOwnedTenant(ses, installation, row) : null
  if (!tenant) {
    try {
      await ses.send(
        new CreateTenantCommand({
          TenantName: row.name,
          Tags: [
            { Key: "opensend:installation", Value: installation._id },
            { Key: "opensend:team", Value: row.organizationId },
          ],
          SuppressionAttributes: {
            SuppressionScope: "TENANT",
            SuppressedReasons: ["BOUNCE", "COMPLAINT"],
          },
        })
      )
    } catch (error) {
      if (!(error instanceof Error && error.name === "AlreadyExistsException"))
        throw error
    }
    // A concurrent create is reusable only after checking its full ownership tags.
    tenant = await getOwnedTenant(ses, installation, row)
  }
  if (!tenant)
    throw new ConvexError(
      "SES tenant was not found after creation. Retry setup."
    )
  if (!suppressed(tenant)) {
    await ses.send(
      new PutTenantSuppressionAttributesCommand({
        TenantName: row.name,
        SuppressionScope: "TENANT",
        SuppressedReasons: ["BOUNCE", "COMPLAINT"],
      })
    )
    tenant = await getOwnedTenant(ses, installation, row)
    if (!tenant || !suppressed(tenant))
      throw new ConvexError("Tenant suppression is not ready. Retry setup.")
  }
  // Preserve AWS/customer pauses. Provisioning must never re-enable a paused tenant.
  return tenant
}
/** Opensend uses dedicated team resources even though AWS permits sharing. */
export async function resourceAssociation(
  ses: SESv2Client,
  tenantName: string,
  resourceArn: string
) {
  const result = await ses.send(
    new ListResourceTenantsCommand({ ResourceArn: resourceArn, PageSize: 10 })
  )
  const others =
    result.ResourceTenants?.filter(
      (tenant) => tenant.TenantName !== tenantName
    ) ?? []
  if (result.NextToken || others.length)
    throw new ConvexError(
      `This SES resource is associated with another tenant${others[0]?.TenantName && /^[A-Za-z0-9_-]{1,64}$/.test(others[0].TenantName) ? ` (${others[0].TenantName})` : ""}. Use another sending domain, or remove that association in AWS before connecting it here.`
    )
  return (
    result.ResourceTenants?.some(
      (tenant) => tenant.TenantName === tenantName
    ) ?? false
  )
}
export async function associateExclusive(
  ses: SESv2Client,
  tenantName: string,
  resourceArn: string
) {
  if (await resourceAssociation(ses, tenantName, resourceArn)) return
  try {
    await ses.send(
      new CreateTenantResourceAssociationCommand({
        TenantName: tenantName,
        ResourceArn: resourceArn,
      })
    )
  } catch (error) {
    if (!(error instanceof Error && error.name === "AlreadyExistsException"))
      throw error
  }
  if (!(await resourceAssociation(ses, tenantName, resourceArn)))
    throw new ConvexError(
      "SES resource association is not ready. Retry verification."
    )
}
export async function disassociate(
  ses: SESv2Client,
  tenantName: string,
  resourceArn: string
) {
  await missing(() =>
    ses.send(
      new DeleteTenantResourceAssociationCommand({
        TenantName: tenantName,
        ResourceArn: resourceArn,
      })
    )
  )
}
export async function removeTenant(
  ses: SESv2Client,
  installation: Doc<"installation">,
  row: Doc<"sesTenants">
) {
  // SES evaluates GetTenant on a name that does not exist against Resource "*",
  // which the scoped policy denies. A row that never recorded an ARN has no
  // acknowledged AWS tenant, so reading one would strand the removal forever.
  if (!row.arn) return
  const tenant = await getOwnedTenant(ses, installation, row)
  if (!tenant) return
  const resources = await ses.send(
    new ListTenantResourcesCommand({ TenantName: row.name, PageSize: 1 })
  )
  if (resources.TenantResources?.length || resources.NextToken)
    throw new ConvexError(
      "SES tenant still has resource associations. Review them in AWS before retrying cleanup."
    )
  await missing(() =>
    ses.send(new DeleteTenantCommand({ TenantName: row.name }))
  )
}
