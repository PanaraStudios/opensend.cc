# v2 security review

Reviewed on 2026-10-05 in `fix/v2-security`, starting at `d5bdf63`.
The local mirror lacked `origin/master`; the upstream master reference
`20e57c5bd7dc6a4a93824a99fa7af2024701080a` was fetched for
`git diff origin/master...HEAD`. No branch was pushed or merged.

The v2 diff was inventoried and the security-sensitive paths traced through
their shared helpers, authorization, storage, and HTTP transports. Calling
internals were inspected only for handoff findings: `services/`,
`convex/calling`, `convex/voice`, and `convex/ivr` were not edited.
No components, scripts, deployment files, SDK, or MCP files were changed.
Locations below refer to the reviewed branch after fixes.

Eight high-confidence findings were fixed in six commits, each with a
regression that demonstrated the defect before the fix. No bypass to a private
network through a team-controlled URL was confirmed. The shared transport's
stream handling, credential redaction, template attribute rendering, and
outbound operation quotas were corrected. The High-severity IVR credential
disclosure remains open for the calling reviewer (S8).

## Findings

Confidence describes the evidence for the issue; severity describes its impact.
Reported concerns were not demonstrated as live attacks. Regression fixtures
use ordinary responses and descriptive dummy values, and contain no attack tools.

| ID | Severity / confidence | Location | Scenario and disposition |
| --- | --- | --- | --- |
| S1 | Medium / high | `lib/net/public-fetch.ts:122` | A team-controlled attachment/media server returns a bodyless status. The new streaming path constructed a Response with a body for 204/205/304, which throws in the asynchronous HTTP callback and can terminate the action outside its normal error handling. **Fixed in `d5c714d`**: construct a null-body response and close the incoming stream. All three regression cases failed before the fix and pass afterward. |
| S2 | High / high | `convex/meta/graph.ts:77`; `lib/meta/errors.ts:129` | Meta error reason fields can echo request credentials. Only the complete Authorization token was redacted; a standalone app secret, debug `input_token`, exchange code/client secret, or subscription verification token could reach stored errors, dashboard messages, and logs. **Fixed in `8e26c0d`**: include sensitive query/form values and the app-token secret component in redaction; redact literal, URI, and form encodings in every error field. The regression failed before and passes afterward. This requires an upstream error to echo the value. |
| S3 | Medium / high | `convex/botTools/execute.ts:35` | Repeated dashboard tool tests made unlimited signed requests to a team's endpoint. The REST request limiter did not cover dashboard actions. Creating more tools or alternating entry points could avoid a resource-level allowance. **Fixed in `4c98cbc`**: a committed, team-keyed quota before IO, shared across tools and dashboard/REST, counting failed network attempts. Concurrent and cross-entry-point regression failed before and passes afterward. |
| S4 | Medium / high | `convex/knowledge/resources.ts:320`; `convex/knowledge/search.ts:52` | A writer could repeatedly re-index the same document, and readers could issue unlimited paid embedding searches through dashboard actions. The 100-document cap did not bound revisions or searches. **Fixed in `4c98cbc`**: team quotas for scheduled indexing and search; rejected indexing schedules no work. Tests for repeated writes and dashboard/REST search failed before and pass afterward. |
| S5 | Medium / high | `convex/whatsapp/templateActions.ts:169`; `convex/whatsapp/templateActions.ts:368` | Repeated publishing can fetch and upload sample media; repeated manual sync can perform up to 60 Graph pages per WABA. Dashboard actions had no operation quota. **Fixed in `4c98cbc`**: team limits before publishing IO and before a whole manual sync, including provider failures. Both regressions fail with the reservation removed and pass with it restored. Hourly scheduled sync retains its existing bounded pagination. |
| S6 | Medium / high | `convex/emailAttachments.ts:35` | Redirect and unsuccessful streaming attachment responses were discarded without cancellation. Slow endpoints could retain sockets and buffers until each 60-second timeout while subsequent redirects opened more connections. **Fixed in `f434a24`**: cancel each discarded response before continuing or returning. The cancellation regression failed before and passes afterward. Each redirect already passes through the shared public-host guard. |
| S7 | Medium / high | `convex/authHttp.ts:33`; `convex/oidc.ts:15` | Configured SSO discovery runs before Better Auth's handler and its request limits. Anonymous sign-in/callback requests could trigger repeated outbound discovery even when discovery failed. This existed before v2 and was checked because SSO is explicitly in scope. **Fixed in `ba93526`**: reserve a team budget before discovery, including failed requests. Regression failed before and passes afterward. The existing auth wrapper still gives its generic authentication failure when exhausted. |
| S8 | High / high | `convex/ivr/definitions.ts:237`; `convex/ivr/definitions.ts:363` | IVR get/list payloads decrypt and return `webhook_signing_secret` to read-authorized consumers, including dashboard queries and read-scoped REST callers. That permits a reader to recover a credential used to authenticate IVR webhook requests. **Reported to the calling review lane; not edited under the repository boundary.** Recommend masked reads and an explicitly authorized provisioning/rotation flow, preserving the public field shape. |
| S9 | Medium / high | `convex/voice/elevenlabs.ts:168`; `convex/voice/elevenlabs.ts:82` | `dashboardRefresh` accepts `force`, which bypasses catalog freshness and can trigger repeated provider requests without a team operation quota. The five-page bound caps each invocation but not repeated invocations. **Reported to the calling review lane; not edited.** |
| S10 | Medium / medium | `convex/meta/ingest.ts:18`; `convex/retention.ts:248`; `convex/ses/sns.ts:83`; `convex/retention.ts:25` | Signatures authenticate provider content but do not enforce delivery freshness. Raw Meta deduplication rows expire after seven days; SES envelope rows after 30 days. Captured old signed deliveries can be accepted again after retention. Message IDs and downstream state transitions provide additional deduplication, so repeat business effects depend on the event and retained rows. **Reported only**: verify replay behavior for management events and expired messages before choosing a freshness window that preserves legitimate provider retries. |
| S11 | Low / medium | `lib/dashboard/csv.ts:80` | Direct formula markers, tab, and CR are escaped, but leading LF/other whitespace and spreadsheet-specific normalization are not covered. A spreadsheet import that strips those prefixes could expose a formula from an exported contact/property/message cell. The helper predates v2. **Reported only**: confirm with the supported spreadsheet applications before expanding neutralization; no spreadsheet exploit was run. |
| S12 | Low / medium | `services/call-gateway/src/voice/toolkit.ts:246`; `services/call-gateway/src/voice/toolkit.ts:267` | The shared embedding helper defaults to global fetch with a fixed Google origin and a 10-second timeout, but has no explicit redirect refusal or byte cap before JSON parsing. No team-configurable provider base URL was found, so this is not a demonstrated team-controlled SSRF path. **Reported to the calling review lane; not edited.** Prefer injecting the bounded shared transport into the app's embedding callers and bounding provider responses in the service helper. |
| S13 | Medium / high | `convex/email/render.ts:12`; `lib/dashboard/email-variables.ts:41` | HTML entity escaping did not prevent whitespace in a merge value from starting additional attributes in hand-written HTML with an unquoted attribute value. Contact or event data could alter the resulting email's markup. **Fixed in `89b93d4`**: use HTML parser source locations to identify unquoted attribute values, then encode their whitespace and delimiters without rewriting the template or changing quoted/text output. A benign attribute-structure regression failed before and passes afterward, covering fragments and full documents. |

## Controls checked

- **SSRF:** bot tools, outbound delivery, knowledge URLs, email attachment
  downloads (including every manually followed redirect), Meta media, and
  template sample downloads use `publicFetch`. OIDC discovery, exchange, and
  JWKS use its Node action bridge. The existing public-host policy rejects
  non-HTTPS URLs, credentials in URLs, IP literals including alternative IPv4
  representations and IPv6 literals, and local names. All resolved addresses
  are checked, including IPv4-mapped IPv6, loopback, private/link-local,
  metadata, and unique-local ranges. Socket lookup stays pinned to a checked
  address with the original Host/SNI, using a new connection. The transport
  does not follow redirects. Existing pinning, private-address, redirect,
  timeout, and byte-bound tests pass. Local HTTP exceptions originate in
  installation configuration and allow only the explicitly configured origin.
  Installation gateway/provider URLs are not team-configurable. The service
  embedding caveat is S12.
- **Inbound webhooks:** Meta reads at most 1 MiB of raw bytes, verifies the
  HMAC using Web Crypto's constant-time verification before decoding/parsing
  or storing, checks the subscription mode/token/challenge, then deduplicates
  the raw body hash transactionally. Projection also checks external message
  identity. SNS limits envelopes to 300,000 bytes, validates their structure
  and an owned topic before fetching a tightly constrained AWS certificate
  URL through `publicFetch`, verifies RSA signatures/certificate validity,
  and deduplicates by topic/message ID. SNS must parse the envelope to obtain
  its signature fields; inner message processing and subscription side effects
  happen only after verification. Subscription confirmation uses the AWS API,
  never the envelope's SubscribeURL. Calling gateway routes authenticate bounded
  raw bodies with timestamp/nonce HMAC before parsing, with transactional claims
  for replay handling. SMTP routes authenticate installation credentials and
  route into shared sending authorization. S10 covers long-retention replay.
- **Secrets:** new provider keys, Meta app/business/Page tokens, encrypted bot
  headers/signing credentials, SSO client secrets, and stored calling webhook
  credentials use server-side encryption. Normal provider/Meta views expose
  masked suffixes and omit ciphertext. SSO credentials stay in component/internal
  reads. Gateway keys are installation environment values; authenticated gateway
  session provisioning necessarily receives runtime credentials. Meta's
  installation-admin-only verification token is intentionally revealable for
  handshake setup and does not authenticate POST events. The pre-existing
  outbound-webhook reveal query is also a deliberate provisioning exception
  to blanket masked reads, outside the new third-party credential fields.
  S2 fixes incomplete error redaction; S8 is the unresolved IVR read disclosure.
  Bot tool response redaction and REST sensitive-body logging were checked.
- **Injection:** shared email rendering HTML-escapes merge values and S13 closes
  unquoted attribute-value injection; subject and
  plain-text values are text. It does not validate URL schemes within
  template-authored attributes, so URL-variable policy still depends on the
  trusted template author and recipient client. Email previews and raw HTML
  editor blocks use closed iframe sandboxes. Contact notes and knowledge text
  are rendered as React text, rather than raw Markdown HTML. IVR/TTS text goes
  into serialized JSON; no shell/SSML interpolation was found in the reviewed
  prompt path. Header validators reject CR/LF and reserved names; download
  filenames are encoded. CSV uses the shared apostrophe/quoting guard; S11
  records its client-dependent edge case.
- **Abuse:** REST requests already share a team-keyed rate limit across keys
  and OAuth grants. SES and channel sends reserve provider throughput, and
  voice calls reserve configured minute/concurrency budgets. New outbound
  quotas close dashboard bypasses for S3–S5 and pre-middleware discovery for
  S7. The live-call custom-tool path retains its existing 128-tool per-call
  bound; a separate aggregate team request rate should be considered by the
  calling reviewer. S9 covers forced catalog refresh.

All new operation limits use the existing Convex rate-limiter component.
They are token buckets keyed by organization, with no resource, API key, or
user identifier in the quota key. Public REST/SDK/MCP response shapes and the
database schema are unchanged.

| Operation | Refill per minute | Burst capacity |
| --- | ---: | ---: |
| Bot tool test | 30 | 10 |
| Document indexing | 10 | 10 |
| Knowledge search | 60 | 20 |
| Template publish | 10 | 2 |
| Manual template sync | 2 | 2 |
| SSO provider discovery | 30 | 10 |

## Validation and handoff

Checks ran serially. Vitest used `--maxWorkers=2`, including the SDK and MCP
scripts' existing worker flags. No package scripts were edited.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed after the final code change. |
| `pnpm lint` | Passed, zero errors. One existing `react-hooks/exhaustive-deps` warning at `components/dashboard/calling/softphone-provider.tsx:117`, left untouched under the calling/UI boundary. |
| `pnpm test` | Passed: 653 tests. |
| `pnpm test:auth --maxWorkers=2` | Passed: 1,260 tests in 82 files. |
| `pnpm test:sdk` | Passed: 627 tests; four opt-in live tests skipped. |
| `pnpm test:mcp` | Passed: 542 tests; one opt-in live test skipped. |
| `pnpm build` | Passed, Next.js 16.2.6/Turbopack compilation, TypeScript, and route generation. Run with `NODE_OPTIONS=--max-old-space-size=2048` for the shared machine. |

All eight fixed findings have before/after regression evidence. Focused tests
also passed for stream handling, Graph error redaction, concurrent team quotas,
knowledge writes/search, template submission/sync, attachment cleanup, SSO
discovery, and email rendering. The full suites above ran after the final fix.

The browser e2e suite and calling harness are deliberately skipped: the lead
runs them on the designated host. `pnpm test` includes unit tests of the fake
Graph fixture under `tests/e2e`, which do not run the browser e2e suite.
No live attack, provider operation, deployment, push, or master edit was performed.
SDK/MCP live-installation tests are opt-in and were not configured in this
worktree; their regular unit/contract suites passed.

The lead should verify normal tool tests, indexing/search, template sample
publishing/sync, and SSO sign-in remain usable; exhaustion displays a readable
message and refill permits retry. Check two members and two API keys share a
team allowance while another team remains independent. Confirm representative
Meta media and redirected email attachments still download, and duplicate
signed Meta/SNS events produce one business effect. In the calling lane,
resolve S8 and S9 and assess S12 before release. Run its browser/e2e coverage
in light and dark modes at 390px as usual; this branch changes no UI.
