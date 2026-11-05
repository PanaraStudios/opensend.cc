<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`packages/backend/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Repo layout

pnpm workspace + Turborepo (`pnpm check` runs what CI runs). Shared code lives
in packages and is imported by package name, never by a relative path into
another package or app:

| Package | What |
| --- | --- |
| repo root | The Next.js dashboard (`app/`, `components/`, `hooks/`, and `lib/` for React hooks and browser/Next-only helpers). Moves to `apps/web` in a later phase. |
| `packages/backend` (`@opensend/backend`) | Convex: schema, functions, generated API. Apps import `@opensend/backend/api`, `@opensend/backend/dataModel` and `@opensend/backend/<module>` for types. The root `convex.json` points Convex at it; the migrate image deploys the package itself (`packages/backend/convex.json`). |
| `packages/core` (`@opensend/core`) | Shared logic and types for every app and the backend: channels, Meta/WhatsApp rules, templates, formatting, dashboard helpers, and the validators the schema uses (`@opensend/core/validators/*`). No UI; never imports an app or the backend. |
| `packages/sdk`, `packages/mcp`, `packages/convex` | Published to npm as `@opensendcc/*`. The SDK also owns the public API contracts (API scopes, WhatsApp and event catalogs) that the backend and apps import from source as `@opensendcc/sdk/src/*`; npm gets only the built entries (`publishConfig.exports`). |
| `services/*` | Calling services with their own images. The backend imports the call-gateway's contracts as `@opensendcc/call-gateway/src/*`. |

`@opensend/core` depends only on npm packages and the SDK/call-gateway
contracts. `@opensend/backend` depends on core. Apps depend on both.
Pure logic tests run with `tsx --test` in the package that owns the code;
backend tests are `pnpm --filter @opensend/backend test` (Vitest + convex-test).

## Icons

`lucide-react` is the only icon library. Import the suffixed names
(`CheckIcon`, not `Check`) and type icon props as `LucideIcon`. Do not add a
second icon package or a local module of inlined SVG paths. Lucide ships no
brand marks, so those live in `components/brand-icons.tsx`; add new ones
there rather than inlining a path at the call site.

Lucide does not apply `shrink-0`. Primitives such as `Button` handle it via
`[&_svg]:shrink-0`, so only add it when an icon sits directly in a flex row.

After making changes, run `pnpm lint` and fix all errors.

## Repository boundary

This repository contains only the open-source application and SES component.
Marketing pages, sponsor checkout, the website Stripe webhook, R2 sponsor storage,
waitlist, analytics, and marketing secrets belong in the private
`PanaraStudios/opensend-website` repository. Keep both builds independent.
