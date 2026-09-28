# Opensend REST contract

[opensend.yaml](opensend.yaml) describes the handlers at `0b10d8d`, using OpenAPI 3.1 and Resend operation IDs/schema names where applicable. The Resend-derived material is MIT licensed; retain [LICENSE-resend](LICENSE-resend) and the YAML attribution comment. The source snapshot’s SHA-256 is embedded in the spec and the [parity report](../docs/resend-parity.md).

Set the server variable `apiOrigin` to the installation’s Convex HTTP action/site origin, without a trailing slash. This is different from the dashboard origin. The contract covers 72 operations: 70 through `apiRoute`, plus the two legacy OAuth grant resource routes. OAuth grant routes have separate token, response, error and pagination behavior; their operation-level security overrides the default bearer scheme. Authentication protocols, tracking, unsubscribe and signed downloads are excluded explicitly in the coverage test.

Run `pnpm test:auth convex/openapi.test.ts` for focused validation, or `pnpm test:auth` for the full backend suite. The test:

- captures application route registrations and checks coverage in both directions, including direct OAuth routes and an explicit list of excluded protocol routes;
- validates the OpenAPI document with Swagger Parser and compiles request/response JSON schemas with Ajv 2020;
- sends authenticated requests through Convex test fixtures and validates real email, domain, contact and template responses, plus authorization/validation errors;
- rejects unexpected response fields and pauses background jobs, with AWS and network calls mocked.

Update the spec alongside handler changes; do not loosen schemas just to accommodate an unexplained failure. Response schemas use required fields and disallow undocumented properties. Request objects generally permit unknown fields because current handlers ignore them; explicit forbidden fields and state-dependent validation are documented separately. Timestamps from `apiTime` are PostgreSQL-style strings, so they are not annotated as RFC 3339 `date-time`. Cross-field totals, UTF-8 byte limits, stored template defaults and authorization checks still require backend validation.

The [parity report](../docs/resend-parity.md) compares all 113 operations in the supplied upstream snapshot and records SDK behavior separately. Its served count excludes common differences from classification; it is not a count of fully identical endpoints. Reconcile this base contract with lane 7A’s implementation changes during integration.
