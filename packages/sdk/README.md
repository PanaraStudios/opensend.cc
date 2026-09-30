# @opensend/sdk

Node.js library for the [Opensend](https://opensend.cc) API. Opensend is a
self-hosted email platform on Amazon SES with a Resend-compatible API, and
this package is a port of [Resend's Node.js SDK](https://github.com/resend/resend-node)
(version 6.30.0, commit `004c938`): the same resources, method names and
`{ data, error, headers }` results.

> Not published yet. It lives in `packages/sdk` of the Opensend repository.

## Install

```bash
pnpm add @opensend/sdk
```

Node.js 20 or later. To send React emails, also install `@react-email/render`.

## Setup

Opensend is self-hosted, so there is no default API address. Pass your
installation's API origin (the Convex HTTP site, `CONVEX_PUBLIC_SITE_URL`) and
an API key from **API keys** in the dashboard:

```ts
import { Opensend } from '@opensend/sdk';

const opensend = new Opensend('os_xxxxxxxx', {
  baseUrl: 'https://api.example.com',
});
```

Or set `OPENSEND_API_KEY` and `OPENSEND_BASE_URL` and call `new Opensend()`.
Without a base URL the constructor throws.

| Option | Environment variable | Default |
| --- | --- | --- |
| key (first argument) | `OPENSEND_API_KEY` | none, required |
| `baseUrl` | `OPENSEND_BASE_URL` | none, required |
| `userAgent` | `OPENSEND_USER_AGENT` | `opensend-node:<version>` |

## Send an email

```ts
const { data, error } = await opensend.emails.send({
  from: 'Acme <hello@acme.com>',
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>It works.</p>',
});

if (error) throw new Error(error.message);
console.log(data.id);
```

The `from` domain must be verified in your installation. Every other resource
works as in Resend's SDK: `batch`, `domains`, `apiKeys`, `contacts`,
`segments`, `topics`, `contactProperties`, `broadcasts`, `templates`,
`automations`, `events`, `webhooks`, `suppressions`, `logs`, `usage` and
`oauthGrants`.

## Migrating from `resend`

Change the import and the base URL. `Resend` is exported as an alias of
`Opensend`, so the rest of your code stays the same:

```ts
import { Resend } from '@opensend/sdk';

const resend = new Resend(process.env.OPENSEND_API_KEY, {
  baseUrl: process.env.OPENSEND_BASE_URL,
});
```

`RESEND_API_KEY` and `RESEND_BASE_URL` are not read, so a leftover Resend
setting can never send your mail to Resend.

## Verifying webhooks

Opensend signs webhooks exactly as Svix does, and `webhooks.verify` checks
them. Opensend sends the values in `svix-id`, `svix-timestamp` and
`svix-signature` headers:

```ts
const event = opensend.webhooks.verify({
  payload: rawBody,
  headers: {
    id: request.headers['svix-id'],
    timestamp: request.headers['svix-timestamp'],
    signature: request.headers['svix-signature'],
  },
  webhookSecret: process.env.OPENSEND_WEBHOOK_SECRET,
});
```

Pass the raw request body, not parsed JSON. It throws when the signature
doesn't match.

## Differences from Resend's SDK

- **No default base URL**, and `OPENSEND_*` environment variables instead of
  `RESEND_*`. The user agent is `opensend-node:<version>`.
- **Older `contacts.*` forms that take `audienceId`** (`create`, `get`,
  `update`, `remove`) call `/audiences/{audienceId}/contacts…`, which Opensend
  does not serve: the server answers 404. Use the forms without `audienceId`.
- **`audiences`** is the segments client, as in Resend's SDK, so it calls
  `/segments`. Opensend also serves the deprecated `/audiences` routes; reach
  them with the generic `get`, `post` and `delete` methods if you need them.
- **`emails.receiving.forward()`** runs in the SDK: it reads the received
  email and sends a new one through `POST /emails`. Both are served; the
  forward itself has not been tested against a live install.
- **Partial operations**: a few endpoints behave slightly differently from
  Resend's. See `docs/resend-parity.md` in the repository.
- **SMTP**: the SMTP gateway's `/smtp/*` routes have no SDK methods. Use any
  SMTP client with the username `opensend` and an API key as the password.

`test/openapi-contract.spec.ts` checks every request the SDK makes against
Opensend's OpenAPI contract (`openapi/opensend.yaml`) in both directions, so a
new endpoint or SDK method without a counterpart fails the tests.

## Development

```bash
pnpm --filter @opensend/sdk test       # unit + contract tests
pnpm --filter @opensend/sdk typecheck
pnpm --filter @opensend/sdk build      # dist/ (ESM, CJS, types)
```

`test/live.spec.ts` runs read-only calls against a real installation when
`OPENSEND_BASE_URL_LIVE` and `OPENSEND_API_KEY` are set, and is skipped
otherwise.

## License

Apache-2.0, like the rest of Opensend. Based on Resend's Node.js SDK,
Copyright (c) 2023 Plus Five Five, Inc., used under the MIT License; its
license text is in `LICENSE-resend`.
