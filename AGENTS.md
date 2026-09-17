<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Icons

`lucide-react` is the only icon library. Import the suffixed names
(`CheckIcon`, not `Check`) and type icon props as `LucideIcon`. Do not add a
second icon package or a local module of inlined SVG paths. Lucide ships no
brand marks, so those live in `components/brand-icons.tsx`; add new ones
there rather than inlining a path at the call site.

Lucide does not apply `shrink-0`. Primitives such as `Button` handle it via
`[&_svg]:shrink-0`, so only add it when an icon sits directly in a flex row.

After making changes, run `pnpm lint` and fix all errors.
