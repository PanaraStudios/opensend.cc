# Wave 4, lane 4A report

Built on integration base `7e185ba`, branch `codex/lane-4a`.

- SES projection: all nine requested event types, atomic SNS deduplication,
  tag/MessageId correlation, team/region checks, monotonic status, recipient
  timeline details, Resend-shaped webhook outbox writes and automatic permanent
  bounce/complaint suppressions. Handles feedback preceding the send response,
  late evidence after ambiguous failures, bounded retries and upgrade replay.
- Tables: new `emailMetrics` and `recipientMetrics`; optional projection marker,
  timeline details and tenant control fields on existing tables. Four aggregate
  mounts plus transactional writers, fixtures and upgrade migrations.
- Functions: `ses/projection:project`, `metrics:summary|domains|domainCount`,
  `ses/reputation:list|count|begin|finish`, `ses/reputationActions:setPaused`;
  shared milestone writer and acceptance helper. Existing `/ses/events` route
  reused; no new REST routes.
- Screens: `/metrics` reads Convex aggregates instead of demo state and uses the
  real clock. Domain picker and breakdown paginate using the shared pager. One
  paginated **Team sending** card added to `/instance/ses`, using existing table,
  badge, menu, card and confirmation primitives. No store changes were necessary:
  metrics owned no demo actions, and no other screen consumed a metrics entity.
- Pause/resume uses IAM revision 2's existing tenant ARN grant, reads back AWS's
  aggregate sending status, requires installation admin throughout, serializes
  controls and checks tenant generation. Failed readbacks keep sending blocked.

Decisions and limitations:

- Delivery evidence outranks pre-delivery failures; bounced/complained feedback
  outranks engagement. All individual outcomes remain in the timeline. Resend's
  docs do not define multi-recipient `last_event` precedence, so this is an
  explicit Opensend policy.
- Delivery/delay/bounce/complaint webhooks use recipient-specific `data.to`.
  SES lacks recipient attribution for multi-recipient opens/clicks; those remain
  message-level. Complaint reports can contain multiple potential complainants
  because mailbox providers redact the actual complainant.
- Metrics count unique email milestones, preserve cumulative delivery/engagement,
  and retain the existing current-status event filter and creation-day cohorts.
  Facts expire with the existing 30-day email retention.
- Reputation rates use per-recipient feedback and accepted sends over 24 hours.
  They are labeled as Opensend-calculated: AWS's variable evaluation sample and
  exclusions cannot be reproduced from GetReputationEntity, which exposes no
  rate counters. Stored sending status reflects provisioning/control readback;
  this lane does not add an AWS polling service.
- Queued sends fail while paused; scheduled sends check at their due time.
  Resume permits new sends and does not retry failures. This keeps failures
  observable and avoids unexpected delayed transactional mail. Already accepted
  or in-flight AWS sends cannot be recalled. Public Resend docs do not specify
  paused-queue retry behavior.
- Deployment, real AWS checks and E2E remain for integration, as instructed.
  The existing upgrade runner includes the new counter backfills and raw-event
  replay; no backend commands, network calls in tests, push or PR were performed.

Verification:

- `pnpm typecheck`: pass.
- `pnpm exec tsc --noEmit -p convex`: pass.
- `pnpm lint`: pass, zero warnings.
- `pnpm test`: 247 passed, zero failed.
- `pnpm test:auth --maxWorkers=2`: 303 passed across 17 files, zero failed;
  includes 27 new lane tests. Two workers avoid unrelated 5-second timeouts
  seen in the unrestricted parallel run.
- One existing assertion in `convex/ses.test.ts` was updated for the clearer
  paused-sending message using a small Python edit, per the shared test-file rule.

New UI strings (including strings reused in the new card):

- `Team sending`
- `Per-region sending status. Volume and recipient bounce and complaint rates are calculated from Opensend events over the last 24 hours; AWS uses its own evaluation window.`
- `Team`, `Status`, `Volume`, `Bounce rate`, `Complaint rate`
- `Pause`, `Resume`
- `Pause sending for {team name}?`
- `Resume sending for {team name}?`
- `Queued emails in this region will fail while sending is paused. Emails already accepted by AWS can still be delivered.`
- `Allow new sends in this region. An AWS sending restriction will still apply. Failed emails are not retried automatically.`
- `UNKNOWN` (fallback status; otherwise displays the AWS status verbatim)
- Pager nouns `tenant` and `domain`; the shared pager generates their plural and
  position text. Existing Cancel, menu accessibility labels and pager labels are
  reused unchanged.

New backend error/fallback strings:

- `Invalid metrics date range`
- `Team SES tenant is not ready`
- `A sending status update is already in progress`
- `Sending is paused for this team. Ask your installation administrator to resume sending.`
- `SES rejected the email`

Implementation decisions and official references are in
[SES tenancy](ses-tenancy.md#event-projection-metrics-and-sending-controls).
The final response lists the commit on this branch.
