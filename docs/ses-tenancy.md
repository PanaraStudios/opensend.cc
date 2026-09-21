# One AWS SES tenant per Opensend team

Opensend teams are backed by native AWS SES tenants, not only database scoping.
The installation still uses one AWS account. Tenant IDs, sending status and
resource associations are regional.

## Provisioning

Creating a team atomically queues creation of its SES tenant in the installation's
default region. Adding a domain in another enabled region creates that team's
regional tenant as needed. A durable Workflow waits for tenant provisioning before
configuring the domain.

Tenants have deterministic installation/team names, installation and full team
ownership tags, and isolated BOUNCE/COMPLAINT suppression lists. SES assigns its
Standard reputation policy to new tenants. Provisioning never re-enables a paused
tenant. Existing names are re-read and ownership is checked before reuse.

For a tenant without a stored ARN, provisioning calls CreateTenant before
GetTenant. Live AWS checks GetTenant for a nonexistent tenant against `Resource:
"*"`, so an existence probe cannot use the tenant-scoped read grant. A create
retry may return AlreadyExists; ownership is still verified before any settings
or associations change. The creation grant is separately constrained by selected
regions and installation/team request tags; tenant reads remain resource-scoped.

Each domain's identity and configuration set are associated with the team's
native tenant. Opensend verifies those associations before marking domain
provisioning successful. Unlike SES's optional shared-resource model, Opensend
refuses resources already associated with another tenant. Existing SES identities
can still be adopted after review if they are not assigned elsewhere.

AWS account quotas, sandbox status and billing remain shared. Native tenant
isolation does not create a separate AWS account or independently raise regional
sending quotas. No shared-IP or account-wide operational isolation guarantee is
claimed.

SES management calls are paced through the official Convex rate-limiter component,
with a separate reservation bucket per region. SDK retries remain disabled.

## Sending contract

The internal `ses/sendContext:get` query derives both `TenantName` and
`ConfigurationSetName` from the team's stored domain binding. It refuses mismatched
teams, missing associations, disabled tenants and unavailable regions. There is
no option to fall back to an untagged account-level send.

Production sending is a later milestone. Every send path (HTTP API, dashboard,
broadcast, automation and SMTP) must use this binding and supply `TenantName` to
SES. Creating a tenant alone does not isolate messages sent without that field.
SES checks the referenced resource associations when a tenant is supplied.

## Cleanup and recovery

Domain removal disassociates its identity and configuration set before deleting
owned resources or restoring an adopted identity. Only after domain cleanup can
the team be deleted. Team removal atomically queues tenant deletion, retains an
audit row and uses a generation check so stale workers cannot overwrite a newer
operation. Deletion waits for running tenant setup to finish.

Cleanup checks ownership again and refuses to remove a tenant with unexpected
remaining resources. Installation administrators can retry failed cleanup in
Amazon SES settings. Pending/failed tenant setup is visible during onboarding;
team admins can refresh it on the domain page. Refreshing domain verification
also provisions missing tenant bindings for domains created before this change.

## Cocomail reference review

Cocomail was read locally as a reference and was not changed. This was a focused
review of its SES tenancy path, not an audit or endorsement of the full codebase.

Patterns retained in Opensend's own implementation:

- Wait for required associations before treating a domain as ready.
- Derive tenant names server-side and carry TenantName in the send contract.
- Remove associations before deleting resources.
- Track provider sending holds independently of application settings.
- Coordinate management-call pacing across concurrent actions.

Choices deliberately not copied:

- Cocomail's domain-create path deletes and recreates an existing identity after
  AlreadyExists. Opensend preserves unrelated resources and requires adoption.
- Cocomail's DKIM helper uses a fixed signing suffix. Opensend uses AWS's returned
  SigningHostedZone.
- Cocomail has an optional tenant-sending rollout switch. Opensend's new send
  binding has no untagged fallback.
- Opensend re-reads existing tenants and verifies installation/team ownership;
  AlreadyExists alone is not evidence that a resource belongs to this team.

## Official AWS references

- [SES tenant management, regional scope and reputation](https://docs.aws.amazon.com/ses/latest/dg/tenants.html)
- [CreateTenant](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateTenant.html)
- [CreateTenantResourceAssociation](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateTenantResourceAssociation.html)
- [Tenant suppression settings](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutTenantSuppressionAttributes.html)
- [SES IAM actions and resource types](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html)
