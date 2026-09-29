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

The transactional Emails API and installation account sender use this binding.
Every future send path (broadcast, automation and SMTP) must use the same binding
and supply `TenantName` to SES. Creating a tenant alone does not isolate messages sent without that field.
SES checks the referenced resource associations when a tenant is supplied.

`emails:createEmail` validates and queues messages; `emailSend:deliver` claims a
generation, submits through SES v2 Simple content (including supported headers
and attachments), and records the result. `opensend_email` and `opensend_team`
tags identify the email and sending team. The `messageId` is stored on acceptance.
SES event projection can use `recordEmailStatus` / `insertEmailEvent` from
`emailRows.ts`, `emailEventData` from `emails.ts`, and the internal
`suppressions:record` mutation. These write helpers keep aggregate counters in
the same transaction. Account mail has `source: "system"` and must never emit
team webhooks or appear in a team's lists.

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

## Event projection, metrics and sending controls

Verified `/ses/events` notifications are deduplicated by SNS topic/message ID.
`ses/state:ingest` schedules `ses/projection:project`; its projection marker,
email status, timeline entries, aggregates, suppressions and webhook outbox writes
commit atomically. It resolves `opensend_email`/`opensend_team` tags, falling back
to SES MessageId, and checks the sending domain's team and region. Unmatched
notifications retry six times over 10.5 minutes; their raw records remain available
for migration replay. Invalid and unsupported records never change email state.

Acceptance is recorded once even when SNS precedes the SendEmail response.
Status precedence is queued/scheduled → sent → delivery_delayed → failed →
delivered → opened → clicked → bounced → complained. Canceled and suppressed mail
cannot be projected into sent mail. This is Opensend's deterministic aggregation
policy: actual delivery can recover an ambiguous sender failure, while recipient
bounce/complaint feedback stays visible even if another recipient engages.
Resend documents event meanings, but does not specify its multi-recipient
`last_event` precedence. All recipient outcomes remain in the paginated timeline,
including SES diagnostic details and their original timestamps.

Delivery, delay, bounce and complaint webhooks are emitted separately for each
reported recipient (`data.to` contains that recipient), matching Resend's
[recipient event visibility](https://resend.com/changelog/webhook-event-visibility).
Bounce payloads include `type`, `subType`, and diagnostic `message`; clicks include
link, IP address, user agent and timestamp; failures include `failed.reason`.
Permanent bounces and complaints feed the existing team suppression writer.
SES transient bounces are final exhausted retries, so they are reported as
bounced but do not automatically suppress the recipient. System email generates
no team webhooks, metrics or suppressions.

Opensend HTTP tracking tokens identify the email, not an individual address in a
multi-recipient envelope. Engagement events retain message-level recipients; no
individual attribution is claimed. SES OPEN/CLICK events are no longer consumed;
see [self-hosted tracking](self-hosting.md#opensend-tracking). SES may also redact the complainant and report all recipients at that
mailbox provider. The timeline retains exactly that provider detail. See the
[AWS event field reference](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html).

`emailMetrics` records unique email milestones and bounce types, scoped by team
and domain. `recipientMetrics` records unique accepted, hard-bounced and complained
recipients with their own timestamps. Both use the shared transactional count
writers. `/metrics` keeps its existing date/domain/event filters, counts email
creation-day cohorts in local calendar days, and counts delivery/open/click
milestones cumulatively even after a complaint. Exact status filters still count
current email status. The domain picker searches up to 100 matching names. The compact breakdown shows
up to 100 domains; selecting a domain reads it directly, including older domains.
Metrics expire with the existing 30-day email retention; long ranges may therefore
contain days with no retained records. The upgrade runner `migrations:backfillCounts`
includes the new domain counter, timeline backfill and raw SES event projection;
no backend commands were run during implementation.

The installation administrator's **Team sending** card lists regional tenants.
Its volume is accepted recipients; bounce and complaint percentages are unique
recipient feedback events divided by accepted recipients in the preceding 24
hours. These are local operational rates, not AWS's reputation scores or an
estimate of its precise evaluation window. AWS uses a variable representative
volume and excludes some feedback, while
[GetReputationEntity](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetReputationEntity.html)
exposes status and reputation impact, not per-tenant rate counters. See
[AWS reputation calculations](https://docs.aws.amazon.com/ses/latest/dg/reputationdashboardmessages.html).

Pause/Resume uses the tenant-scoped IAM grant and
`UpdateReputationEntityCustomerManagedStatus` (`DISABLED` / `ENABLED`), followed
by `GetReputationEntity` to save the aggregate sending status. Resuming cannot
clear an AWS restriction. Every control/read requires installation-admin access;
ordinary team owners and members cannot change it. Operations are serialized,
generation-checked, and keep the local send gate closed until a successful
readback; a failed readback stores UNKNOWN. A stalled operation can be retried
after five minutes. Pausing cannot recall an in-flight AWS request or mail already
accepted by SES.

Queued messages fail with `email.failed` at claim time while paused. Scheduled
messages are checked when they become due. Resume permits new sends; it never
retries failed mail automatically. This preserves the sender's existing permanent
failure semantics, produces an observable failure instead of an indefinite hold,
and avoids stale transactional mail being delivered unexpectedly on resume.
Resend's public docs describe failed events but do not specify paused queue retry
behavior, so this queue policy is an explicit Opensend choice.

## DNS ownership claims

Domain names are reserved across the installation, independent of sending
region. Claim placeholders have `claimPending: true` and never reserve an SES
identity; inbound routing and tracking-host lookup exclude them. A team may
resume its single current claim for a name. Legacy names with multiple active
regional rows cannot be claimed until their owner resolves the ambiguity.

After exact server-side TXT proof, one transaction checks for queued/scheduled
mail and active domain operations, locks the old domain with `transferClaimId`,
disables sending and starts the existing removal workflow. Email enqueue/send
gates observe the same domain row, so new mail cannot cross that boundary.
Removal's successful completion tombstones the old row and emits its normal
event, then reserves the name for the placeholder and starts normal provisioning.
Each failed SES step retains its operation and ownership lock for retry. Imported
identities are blocked, because removal must preserve their external ownership.
The existing revision 3 delete/associate/provision permissions suffice; the policy
revision is unchanged. No AWS or deployment commands were run for this feature.
