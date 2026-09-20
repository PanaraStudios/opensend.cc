# OpenSend product boundary

Decisions captured 2026-09-12. This is the implementation brief, not a claim that the service below already exists.

## Repositories and responsibilities

- **k4stack** remains the reusable starter kit. OpenSend is a separate application created from that kit, using its established frontend/backend/auth/UI setup. Do not replace the starter's generic application with email-product tables or screens.
- **OpenSend** provides a self-hostable SES-backed transactional-email platform. Use self-hosted Convex plus the k4stack dashboard stack. The Convex infrastructure dashboard is an operator tool; build a separate end-user email dashboard.
- **The SES component** is the existing reviewed delivery engine. Extract it as a reusable package and retain its tests, examples, license, and attribution. Proposed package name: `@opensend/convex-ses` (availability not checked). It is not a Resend-compatible HTTP server by itself.
- **A future OpenSend Convex client/component** provides the familiar Resend component DX against the OpenSend service. Do not conflate this with the internal direct-to-SES engine.

Suggested structure inside the new application:

```
opensend/
  app/                    # dashboard based on k4stack
  convex/                 # service API, authentication, domains, keys, suppression
  packages/convex-ses/    # reviewed delivery engine
  packages/convex/        # OpenSend service client for Convex apps
  tests/compatibility/    # public Resend API/SDK contract tests
  deploy/                 # self-hosted Convex + app + TLS + persistent storage
```

The standalone exporter deliberately includes only the component, not k4stack's product/marketing code or environment files. The OpenSend application itself should be instantiated from k4stack as a separate project. Publishing either repository remains a separate operation.

## Product promise

Set up an AWS SES connection once, then use the dashboard to add sending domains, publish their DNS records, verify status, create/revoke scoped API keys, send email, inspect delivery history, and manage suppression. Additional domains still require DNS ownership verification and are subject to AWS identity quotas; do not promise literally unlimited AWS resources.

[Official SES quotas](https://docs.aws.amazon.com/ses/latest/dg/quotas.html) and [domain verification](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html) govern those boundaries.

Domain registration belongs in OpenSend's service layer. Use AWS-returned DKIM record values, persist identity ownership, and check authorization plus current verification status before accepting a sender. API callers never receive AWS credentials.

## Resend compatibility is a tested contract

Pin an official [Resend OpenAPI](https://github.com/resend/resend-openapi) revision and SDK version. Match routes, HTTP methods, request/response JSON, error names/status codes, pagination, timestamps, idempotency behavior, headers, key permissions and webhook payloads. A familiar class name alone is not compatibility.

The official [Node SDK](https://github.com/resend/resend-node/blob/main/src/resend.ts) accepts a custom `baseUrl`. The intended acceptance test is an unchanged SDK pointed at OpenSend:

```ts
import { Resend } from "resend"
const resend = new Resend(process.env.OPENSEND_API_KEY, {
  baseUrl: process.env.OPENSEND_BASE_URL,
})
await resend.emails.send({ from, to, subject, html })
```

This is a target for the new service, not functionality the extracted engine currently exposes. The existing Convex Resend component also requires a configurable API endpoint and compatible outgoing webhook signatures; REST compatibility alone does not redirect its provider calls automatically.

The first public compatibility milestone should cover transactional email send/retrieve/list/batch, scheduled send/cancel where documented, domains, API keys, templates, suppression and signed outgoing webhooks. Track the remaining Resend surfaces (such as contacts, broadcasts, inbound email and automations) explicitly. Do not advertise complete Resend parity while they remain unimplemented.

AWS-native events from the engine must be mapped to Resend-compatible public events. Keep AWS SNS ingress verification separate from outgoing customer webhook signing, retries, event IDs, replay/redelivery and dead-letter handling.

## Suppression becomes a service responsibility

OpenSend must own a durable recipient suppression table and management panel. Signed feedback updates suppression transactionally for permanent bounce recipients and complaint recipients, deduplicated by event ID. Never suppress every address on a message just because one recipient bounced. Temporary failures/delays must not create permanent suppression.

Check suppression both when accepting new email and immediately before handing queued email to the engine. The existing engine must gain a service integration hook or equivalent transactional guard for that latter boundary; only checking at enqueue would let previously queued mail bypass newly received complaints. Preserve suppression beyond routine email-history cleanup. Restoring an address must be an explicit authorized, audited operation.

Enable SES BOUNCE and COMPLAINT suppression as the transport backstop. [AWS suppression semantics](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html) still apply. Neither layer guarantees all mailbox providers will report complaints.

## Security and reliable sending

- Persist only hashes of high-entropy OpenSend API secrets; show a new key once. Support sending-only versus full-access scopes, domain restrictions, revocation, last-used metadata and audit records. Do not allow a sending-only key to create full-access keys.
- Authorize every domain, email, API key and suppression operation by installation/workspace. Global unique IDs are not authorization.
- Keep AWS credentials server-side. The current engine's persisted credential snapshots are unsuitable as a casual multi-customer credential store; a hosted service needs a deliberate connection/credential lifecycle, access boundaries and rotation design.
- Keep SES acceptance, durable app IDs and client idempotency distinct. SES cannot guarantee exactly-once sending after a lost response or crash. API acceptance/dedupe can be transactional without promising exactly-once inbox delivery.
- Enforce request/body/recipient limits and application abuse controls. Verify the owner bootstrap, login/session behavior, TLS setup, backups/restores and upgrades before offering hosted access.
- OpenSend must work without an OpenSend-operated account or server when self-hosted, apart from its configured AWS services and optional explicit integrations.

## Self-hosted and hosted versions

The user selected self-hosted Convex. Use the [official self-hosting instructions](https://docs.convex.dev/self-hosting) and pinned backend versions. Package the end-user app separately from the Convex backend/admin dashboard. Provide persistence, backup/restore, deployment migrations, public HTTPS ingress for SNS and documented resource requirements.

Recommended first hosted offering: OpenSend hosts the app/service; customers connect their own AWS SES account and pay AWS for delivery. This is a recommendation, not a confirmed decision to charge users. Keep product features and API behavior consistent with the free self-hosted distribution.

A later fully managed sending offering through OpenSend-owned AWS accounts needs tenant isolation, abuse screening, account/reputation management, usage enforcement, billing and an operational response process. A shared SES account must not be treated as reputation isolation. Separate IAM users alone do not create separate SES account reputation/quotas.

Donations can support maintenance. Hosting can be optional and priced to cover operations if the maintainer chooses. Do not make the free edition depend on a paid feature gate for core transactional-email functions.

## License boundary

The extracted engine retains its existing Apache-2.0 license. Preserve original notices and review which k4stack assets/code are intended for the public application.

The current Convex backend uses [FSL-1.1-Apache-2.0](https://github.com/get-convex/convex-backend/blob/main/LICENSE.md), with a future Apache grant and competing-use restrictions. Document that runtime dependency accurately rather than describing the entire stack as presently Apache-licensed. OpenSend's application license is a separate decision; do not silently relicense Convex's backend or present its admin backend as your own hosted database product.

## Maintainer programs (verified 2026-09-12)

- [Claude for Open Source](https://claude.com/contact-sales/claude-for-oss): six months of Claude Max 20x. The current page lists ecosystem adoption, significant external contributions, community participation or infrastructure criticality as routes; it also accepts explanations from projects outside the stated criteria.
- [Codex for Open Source](https://openai.com/form/codex-for-oss/): selected maintainers receive six months of ChatGPT Pro including Codex, with API credits and conditional Codex Security access. It evaluates active maintenance, real usage/adoption and ecosystem importance.
- [OpenAI's Codex Open Source Fund](https://openai.com/form/codex-open-source-fund/): the official application page also describes grants up to $25,000 in API credits. Do not assume an award or that programs can be combined.

A purchased domain and an initial repository do not establish eligibility. Publish working software, meaningful tests, setup docs, releases, issue/PR history and honest adoption evidence before relying on these benefits. An existing qualifying contribution history can also be relevant. No applications have been submitted.
