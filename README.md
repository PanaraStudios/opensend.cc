# Opensend

The open-source Opensend application with built-in Amazon SES setup.

**Website:** [opensend.cc](https://opensend.cc)

## Status

Authentication, teams, SSO and OAuth use Convex. Installation onboarding and domains
now use persistent Convex state and AWS SES. Other dashboard features still use
the demo store while their backend milestones are implemented. The standalone
`packages/ses` package has been retired; its implementation lessons and regression
scenarios are preserved in [the archive](docs/legacy-ses/README.md).

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

Open http://localhost:3000. `/` redirects to `/emails`. Sign up for the first account, verify using the backend logs, and log in to start
the setup wizard. App pages are excluded from indexing.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See [SES onboarding](docs/ses-onboarding.md) and the [remaining milestones](docs/parity-backlog.md).

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

## Self-hosted authentication

Run `pnpm setup` to start the Docker stack. See [self-hosting](docs/self-hosting.md) for setup, account verification, OIDC, backups, and recovery.
