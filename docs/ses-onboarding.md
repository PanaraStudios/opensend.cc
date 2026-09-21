# SES installation and domains

This milestone embeds SES setup into Opensend. Authentication, invitations, teams,
SSO, and OAuth keep their existing providers. The bootstrap account is the
installation administrator; a team administrator does not gain installation access.

## Run the wizard

1. Run `pnpm setup`, then open `/signup`. Verify the first account through the
   backend logs and log in.
2. **Connect AWS.** Choose a region and enter your account ID and access key.
   Opensend creates an encryption key and saves your progress automatically.
   **Create AWS user** opens inline help if you need keys. Additional regions
   and an existing server role are under **Advanced options**.
3. Opensend checks the detected HTTPS backend URL and sets up AWS resources.
   Local installations must enter a public HTTPS URL first. Use a tunnel to the
   backend HTTP service, not the dashboard. The default port is **3211**; the
   review instance uses **3511**. Opensend checks that the URL reaches this
   installation. Failed checks and resource setup show a retry option.
4. **Create your team.** Name your workspace once AWS is ready.
5. **Add your sending domain.** Enter it directly in the wizard. Region and
   Return-Path settings are under **Advanced options**. Saving opens
   `/domains/{id}` in the dashboard, where you add DNS records and verify them.

The wizard uses the auth layout and shows three steps. Delivery checks and AWS
resource setup run within the AWS step. Before completion,
Back navigation and reloads preserve the saved step. After completion the wizard
closes and all dashboard navigation is available. AWS credentials are never persisted as
browser drafts. Pending DNS, SNS confirmation or AWS production approval remain
visible after setup.

Only `us-east-1`, `eu-west-1`, `sa-east-1`, and `ap-northeast-1` are offered in this
milestone, matching the existing dashboard selector. More commercial regions and
other AWS partitions are tracked in the parity backlog.

For local Docker, setup derives `CONVEX_BACKEND_ORIGIN` using
`host.docker.internal`, because Node actions cannot call a published host port
through the container's own `localhost`. For remote hosting, set this to the
public Convex origin reachable from inside and outside Docker. Storage URLs use
that origin too; local browsers must resolve `host.docker.internal` to the host.

## Guided AWS access creation

On the AWS connection screen, **Create AWS user** downloads a CloudFormation
setup file with `opensend` as the default user name and the required permissions
for the selected regions. **Open AWS setup** opens the CloudFormation console.
Upload the file, use the copied stack name, review the IAM acknowledgement and
submit. AWS determines the account ID from the account you are signed into.
The template creates a dedicated user and a scoped managed policy; it does not
create console access or expose access-key secrets in stack outputs.

After the stack completes, open the user in IAM and create an access key. Download
the key CSV, then use **Import AWS key CSV** in Opensend. CSV parsing stays in the
browser; keys are sent to the backend only when you choose **Connect AWS**.
Existing SES users can enter their existing keys instead, provided those keys have
the required setup permissions. If the user name already exists, choose a different
name in the helper. Regenerate/update the policy when enabling additional regions.

AWS does not document a create-user URL that preselects policies. Its supported
[quick-create links](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stacks-quick-create-links.html)
require an S3-hosted template. This local flow uses upload and does not pretend
that a localhost template URL will work in AWS. A hosted one-click launch would require a parameterized template published
to S3. The user and policy are retained on stack deletion to avoid
unexpectedly breaking an active connection; remove them explicitly in IAM when
retiring the installation.

During installation, Account settings remain unavailable, including through direct
Profile/Settings URLs. Saving the first domain finishes setup and opens the normal
domain page with the full dashboard navigation. Team switching, invitations,
profile menus and global search remain hidden until setup finishes. Public team
management and invitation mutations also require setup completion. The first-team
creation is allowed only at the wizard's team step and advances it atomically.

## Credentials and permissions

A backend role uses the official AWS Node credential provider chain, allowing
instance/container/web-identity credentials to renew. Configure its runtime
credentials on the Convex action host; a role available only to the Next.js
container is insufficient. Encrypted access keys are supported where roles are
unavailable. Session-token credentials expire and must be replaced manually.

Access keys use AES-256-GCM with a random per-installation key. The wizard
creates the key and stores only an encrypted copy in Convex. A separate wrapping
key is derived with HKDF from the existing server authentication secret and an
SES-specific context. Neither key nor ciphertext appears in public query results.
Keep the existing server authentication secret with database backups; changing it
requires rewrapping the key or reconnecting AWS first. Existing v1 credentials
remain readable with their original SES encryption environment key.

Workflows contain resource IDs and load current credentials only inside actions.
Replacement credentials are validated before activation using a revision check.

Provisioning requires the following IAM actions. This is a **setup** policy,
not the future mail-sending policy. Substitute the account, enabled regions,
installation ID displayed in the resource preview, and allowed sending domains.
Use an AWS role with these permissions, or a dedicated least-privilege IAM user.

| Resource scope                                                         | Actions                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `*` (AWS APIs without resource-level scope)                            | `sts:GetCallerIdentity`, `ses:GetAccount`                                                                                                                                                                                                                                                                                                                          |
| `arn:aws:ses:REGION:ACCOUNT:configuration-set/opensend-INSTALLATION-*` | `ses:CreateConfigurationSet`, `ses:GetConfigurationSet`, `ses:DeleteConfigurationSet`, `ses:ListTagsForResource`, `ses:TagResource`, `ses:PutConfigurationSetSuppressionOptions`, `ses:PutConfigurationSetDeliveryOptions`, `ses:GetConfigurationSetEventDestinations`, `ses:CreateConfigurationSetEventDestination`, `ses:UpdateConfigurationSetEventDestination` |
| `arn:aws:ses:REGION:ACCOUNT:identity/YOUR_DOMAIN`                      | `ses:CreateEmailIdentity`, `ses:GetEmailIdentity`, `ses:DeleteEmailIdentity`, `ses:PutEmailIdentityMailFromAttributes`, `ses:PutEmailIdentityConfigurationSetAttributes`, `ses:TagResource`, `ses:UntagResource`                                                                                                                                                   |
| `arn:aws:sns:REGION:ACCOUNT:opensend-INSTALLATION-events`              | `sns:CreateTopic`, `sns:GetTopicAttributes`, `sns:ListTagsForResource`, `sns:TagResource`, `sns:SetTopicAttributes`, `sns:ListSubscriptionsByTopic`, `sns:Subscribe`, `sns:ConfirmSubscription`, `sns:GetSubscriptionAttributes`, `sns:SetSubscriptionAttributes`                                                                                                  |
| `arn:aws:sqs:REGION:ACCOUNT:opensend-INSTALLATION-events-dlq`          | `sqs:CreateQueue`, `sqs:GetQueueUrl`, `sqs:GetQueueAttributes`, `sqs:ListQueueTags`, `sqs:TagQueue`, `sqs:SetQueueAttributes`                                                                                                                                                                                                                                      |

SNS subscription attribute operations authorize against the parent topic. The
generated template scopes these grants to the installation’s regional topic.
An AWS denial reports the failed operation without exposing the raw request or
credentials. SCPs, permission boundaries and session policies also apply. IAM
simulation is not presented as proof that provisioning will succeed.

If tenant setup fails, the domain page shows the tenant error and explains why DNS
records are not available. **Download IAM permissions** exports the current policy
with the installation's account, regions and resource names filled in. For an AWS
access denial, review/update the existing user's managed policy in IAM, then choose
**Retry operation**. This retries tenant setup and continues domain provisioning;
it does not require replacing the access key. An explicit deny in an organization
policy or permission boundary must be resolved separately. Opensend cannot modify
its own IAM permissions.

Native SES tenant creation, suppression settings, association inspection and
association deletion are also included in the generated policy. `CreateTenant`
uses a separate `Resource: "*"` grant limited by the selected regions, the exact
installation request tag and a nonempty team request tag. Existing tenant ARNs are
scoped to `tenant/opensend-INSTALLATION-t-*`; association permissions include the
tenant and its identity/configuration-set resources. See [SES tenancy](ses-tenancy.md)
for the per-team lifecycle. The generated template in `lib/aws/setup.ts` is the
executable permission definition; the table above summarizes domain/regional setup.

## Resource ownership and recovery

Regional SNS topics use signature version 2. Their SES publishing policy is
limited to this account and Opensend configuration-set prefix. The SQS queue
uses SQS-managed encryption, a 14-day retention period, and a topic-scoped
redrive grant. The HTTPS subscription has a dead-letter redrive policy.

Every created identity, configuration set, topic and queue is tagged with its
installation owner; identities/configuration sets also carry the domain ID.
Deterministic names and ownership checks let a partial operation retry safely.
AWS SDK retries are disabled. Convex Workflow persists the operation across
backend restarts. A failed operation exposes a retry control and an error in
regional status or domain history.

Existing identities are initially refused. On the failed domain page, the
installation administrator can review the current configuration set and MAIL
FROM, then explicitly approve their replacement. A fingerprint rejects stale
reviews. Easy DKIM records and unrelated tags are preserved. Removal restores
adopted identity settings instead of deleting the identity. If another operator
changes those settings while Opensend owns them, removal stops for review.

Deleting a domain disables sending immediately, removes only owned AWS resources,
and retains a database tombstone and history. Re-adding creates a new ID;
previous domain-scoped API keys never become unrestricted or acquire that ID.
DNS records remain under the operator's control. Teams with active domains cannot
be deleted (including a last-member departure). The installation administrator
cannot delete their account while AWS is connected, preventing orphaned resources.

DNS resolution and SES verification are separate. DKIM values use AWS's exact
`Tokens` and `SigningHostedZone`. Custom MAIL FROM uses `REJECT_MESSAGE` when MX
verification fails. TLS policy changes are applied to the domain's configuration
set. DNS integrations, HTTPS tracking, and receiving are later milestones.

## Operational limits

- Changing callback/app origins after AWS resources exist needs an explicit
  subscription migration; the wizard refuses that change for now.
- Enabled regions cannot yet be removed while resources may reference them.
- SNS signatures and topic ownership are checked before confirming subscriptions
  or storing events. Notifications are deduplicated. Recipient feedback processing
  and customer webhooks belong to later milestones; stored events are not yet
  transformed into delivery outcomes.
- The remaining dashboard features still use their existing demo store. This
  milestone supplies no production send endpoint, API key service, SDK, or SMTP.
- Backups need both Convex data (including components) and deployment secrets.
  A restored database needs the same server authentication secret (and the legacy
  SES encryption key for any v1 credentials).
  Stop the original instance before restoring into another live sender.

## Official references

- [Convex best practices](https://docs.convex.dev/understanding/best-practices/)
- [Convex Workflow](https://www.convex.dev/components/workflow)
- [AWS IAM guidance](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [SES identity creation and DKIM hosted zones](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateEmailIdentity.html)
- [Regional account quotas and sandbox state](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_GetAccount.html)
- [SNS dead-letter queues](https://docs.aws.amazon.com/sns/latest/dg/sns-dead-letter-queues.html)
- [SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html)
