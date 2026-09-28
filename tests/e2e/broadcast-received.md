# Broadcast and received-mail coverage

`broadcast-received-flow.ts` registers four tests inside `auth.spec.ts`'s serial
describe, immediately after the dashboard smoke test. No product endpoints,
schema, permission checks, or UI were changed.

- Broadcast: create and reopen the visual document, persist its envelope and
  audience, export and render merge tags, review eligible contacts, queue a test
  email, schedule, cancel, send immediately, and inspect settled failures and
  suppression metrics. The review excludes a suppressed contact; the final
  report includes its suppressed recipient copy. Synthetic credentials fail
  before any AWS request.
- Draft permissions: a plain member edits, invalid input fails, a member of
  another actual team cannot read/update/delete, and UI deletion removes the
  draft. The existing member has not joined yet at this point in the suite, so
  the guarded Better Auth admin fixture temporarily changes the owner's
  membership and restores it in `finally`.
- REST broadcast: a key created and revealed in the UI creates, lists, retrieves,
  and deletes a draft, followed by a 404 on retrieval.
- Receiving: enable the existing Records-tab switch, observe the fixture's AWS
  refresh failure, seed the receipt-rule result, upload MIME and an attachment
  to Convex storage through its admin function, and call `received.complete`.
  Repeating completion must not duplicate the message or webhook. The UI shows
  envelope, HTML preview/source, and text. REST checks metadata/authentication,
  raw MIME, attachment metadata and bytes, a tampered signature (404), and
  missing API credentials (401).

The received detail has no authentication or attachment controls, so those
assertions use REST. Webhooks reject `host.docker.internal`, including HTTPS;
there is no equivalent to `ALLOW_LOCAL_OIDC`. The test asserts that rejection
and one durable metadata-only `email.received` delivery for a reserved `.invalid`
host. Actual HTTP receipt and Svix headers remain unverified; no local-webhook
exception was added.

Run the full Docker suite through `pnpm test:e2e` during integration. This lane
only ran discovery (`pnpm exec playwright test --list`), not browser execution.
First runtime checks: visual-editor locators and reopen export, schedule/cancel
redirects, asynchronous failure settlement, admin storage upload/table-data
commands on the stack's Convex version, and receiving refresh completion.

References used to check the contracts:
[create broadcast](https://resend.com/docs/api-reference/broadcasts/create-broadcast),
[received webhook](https://resend.com/docs/webhooks/emails/received), and
[Convex admin storage functions](https://github.com/get-convex/convex-backend/blob/main/npm-packages/system-udfs/convex/_system/frontend/fileStorageV2.ts).
