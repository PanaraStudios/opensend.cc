# Changelog

## 0.1.0

- Initial Apache-2.0 Convex component for self-hosted and hosted OpenSend APIs.
- Durable workpool delivery with retry backoff and stable API idempotency keys.
- HTML/text and stored templates, tags, API scheduling, topics, and bounded attachments.
- Status, detail, best-effort cancellation, enqueue deduplication, and batched cleanup.
- Signed svix/webhook verification, monotonic status, engagement flags, and transactional application callbacks.
- Official component exports, generated bindings, convex-test registration, and a Convex example.
- Unit/integration tests and an isolated Docker tarball-consumer harness using synthetic SES fixtures.
- Requires SDK 0.1.2's V8-safe send entry; release that SDK before this package.
