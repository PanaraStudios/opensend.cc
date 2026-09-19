# Opensend

The self-hosted [Resend](https://resend.com) alternative. Open-source email API you run yourself: Resend-compatible REST and SMTP, on Next.js, Convex, Better Auth and AWS SES.

**Website:** [opensend.cc](https://opensend.cc)

## License

Opensend is licensed under the [Apache License 2.0](./LICENSE). Copyright 2026 [Panara Studios](https://panarastudios.in).

The SES delivery engine in [`packages/ses`](./packages/ses) is also Apache-2.0.

Self-hosting Convex uses Convex’s own backend license ([FSL-1.1-Apache-2.0](https://github.com/get-convex/convex-backend/blob/main/LICENSE.md)). That is a runtime dependency of a self-hosted stack, not source in this repository.

## Status

This repository currently includes:

- The public site (`app/(marketing)`)
- The AWS SES Convex delivery engine (`packages/ses`)

The Resend-compatible HTTP API, product dashboard, Docker Compose deploy, and docs are still being built. Until then, the repo is the source of truth.

## Develop

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

The SES component has its own setup guide: [`packages/ses/RUNBOOK.md`](./packages/ses/RUNBOOK.md).

## Operator

Opensend is a product of [Panara Studios](https://panarastudios.in). Questions: info@panarastudios.in
