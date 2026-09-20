# Opensend

The open-source Opensend application and AWS SES delivery component.

**Website:** [opensend.cc](https://opensend.cc)

## Status

This repository contains the product dashboard, email editor, and the AWS SES
Convex delivery engine in `packages/ses`. The dashboard currently uses a local
demo store. Backend integration, authentication, the Resend-compatible HTTP API,
and Docker Compose deployment are still being built.

The marketing website is maintained separately in the private
`PanaraStudios/opensend-website` repository. Its pages, sponsor checkout, Stripe
webhook, R2 logo storage, waitlist, and analytics are not part of this app.
UI components and styles are local copies; neither repository imports from the other.

## Develop

Requires Node.js 20.9+ and [pnpm](https://pnpm.io).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open http://localhost:3000. `/` redirects to `/emails`. Authentication routes
currently link to the public Cloud waitlist. App pages are excluded from indexing.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The SES component has its own setup guide:
[`packages/ses/RUNBOOK.md`](./packages/ses/RUNBOOK.md).

## Deployment boundary

Deploy the app and marketing website from their own repositories and environment
variables. The marketing deployment owns `opensend.cc`; an app deployment needs
a separate domain. Before deploying this app in place of the former combined
site, switch the marketing host to the private website repository and configure
its Stripe, R2, Cocomail, and DataFast environment variables there.

## License

Opensend and the SES delivery engine are licensed under the
[Apache License 2.0](./LICENSE). Copyright 2026 Panara Studios.
Self-hosting Convex uses Convex's own backend license; see the SES runbook.

## Operator

Opensend is a product of [Panara Studios](https://panarastudios.in).
Questions: info@panarastudios.in
