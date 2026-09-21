# Parity backlog

Milestone 1: installation onboarding and domains, pending manual AWS acceptance.
Continue on a separate branch after its acceptance gate.

1. API foundation, hashed keys, restrictions, OAuth enforcement and request logs.
2. Shared sending services, batching, scheduling, cancellation, content staging,
   feedback, suppressions and uncertain-send reconciliation; connect auth mail.
3. Customer webhooks and durable delivery history, replay and rotation.
4. Published templates and immutable queued versions.
5. Contacts, segments, topics, CSV imports and unsubscribe preferences.
6. Broadcast expansion, subscription checks and statistics.
7. Versioned durable automations and run history.
8. SES receiving, private S3 storage, MIME and attachments.
9. Optional TLS SMTP gateway feeding the shared sending service.
10. Remaining dashboard settings, metrics, exports, retention, DNS integrations,
    public HTTPS tracking, search and health.
11. Resend-style TypeScript SDK, React Email and Opensend Convex component.

Beyond existing screens: additional SES regions/partitions; region disablement;
callback-origin migration; dedicated IP pools; CLI/MCP tooling; fine-grained
installation administrator transfer and recovery; IAM policy generation; automated
production-access requests; backup/restore drills against a live AWS installation.

The supported Resend endpoint compatibility matrix will be introduced with the
API foundation. No Resend compatibility is claimed by milestone 1.
