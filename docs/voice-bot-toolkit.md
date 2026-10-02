# Voice bot toolkit (Wave 8e)

Knowledge bases and webhook tools belong to a team and can be reused across bots.
Collection fields belong to a bot. Both Gemini Live and the cascade expose the same
attached tools; the bot config snapshot on a call controls access for that call.

## Knowledge

Create a knowledge base in Playground → Knowledge, then upload PDF, TXT, Markdown
or DOCX, add a public HTTPS URL, or paste text. Each document shows Processing,
Ready or Failed with a readable reason. Editing or re-indexing starts a new revision;
stale jobs cannot publish over it, and search only returns the current ready revision.
Deletion cleans up text, chunks and file references, and deleting a base detaches it
from saved bots through bounded jobs.

Ingestion and search use the team's first saved Gemini provider credential. Add it
in Settings → AI providers. The
[official Gemini embedding guide](https://ai.google.dev/gemini-api/docs/embeddings)
supports `gemini-embedding-001`, retrieval document/query task types and 768 output
dimensions; shortened vectors are normalized. Chunking approximates 800 tokens with
100 overlap, conservatively treating non-ASCII characters as one token each.
Convex vector search filters the combined organization/base scope, then checks
ownership and revision again before returning titles and matching text.

Limits are 2 MB per file or URL response, 200 PDF pages, 200,000 extracted characters,
100 chunks per document and 100 documents per base. DOCX uses a pure-JS parser and an
8 MB expanded archive cap. Scanned PDFs need OCR before upload. URL fetches pin public
DNS addresses, cap execution at ten seconds and never follow redirects. The tiny-base
instruction summary option is deliberately omitted; bots search attached material.

Attach up to sixteen bases in bot settings. `search_knowledge(query)` retrieves up to
five titled matches for the bot; runtime instructions require answers grounded in
material, acknowledgement of missing answers, and treating documents as untrusted
reference content. Playground's Test search uses the same retrieval path.

REST exposes `/knowledge-bases`, `/{id}`, nested `/{id}/documents`, document
`/{documentId}` and POST `/{id}/search`. CRUD uses `knowledge:read|write`; search uses
read. Upload files through the existing media API with `use: "knowledge"`. SDK methods
are `opensend.knowledgeBases` and `.documents`; MCP exposes corresponding CRUD and
`search-knowledge-base` tools. Lists use ID cursors.

## Collection

A bot's optional `collect` array supports text, number, boolean, email, phone, date
and enum fields, with labels, descriptions, required flags and optional contact
property mappings. Settings includes a property picker and creation option. Up to
32 fields are allowed. `save_field(key, value)` validates scalar types, preserves
zero/false, resolves the caller through the same identity path as notes, and updates
mapped existing contact properties. String properties accept scalar values converted
to text; number properties accept number fields.

Calls expose `collected: { [key]: { value, inferred } }`. Missing values may be inferred
at completion using the configured summary model only at confidence ≥ 0.95 with a
verbatim caller transcript quote. Explicitly saved values win. Failure leaves a field
missing. `call.data_collected` is emitted once when the bot session ends, with call ID,
contact ID, collected values and missing required keys; Playground calls suppress
production events. The event is available to webhook subscriptions and automations.
Call detail marks inferred values.

## Webhook tools

Playground → Tools provides reusable tools, a parameter row builder, an advanced
JSON view, encrypted header secrets, a result field allowlist and a saved-tool test
request. REST `/bot-tools` and `/{id}` use `bot_tools:read|write`; POST `/{id}/test`
requires write. SDK exposes `opensend.botTools`; MCP includes CRUD and
`test-bot-tool`. Secret headers and signing secrets are write-only; omitted secrets
remain unchanged on edit. Supply a shared signing secret to verify requests at your
endpoint; an omitted secret is generated privately.

Names must be unique snake_case names within the team and cannot shadow built-ins.
Parameters are an object with at most 32 scalar string/number/boolean properties,
descriptions, typed enums, required keys and no additional properties. Nested objects,
arrays, references and arbitrary schema keywords are rejected. Attach up to sixteen
tools in bot settings. Team/call authority always comes from the authenticated call.

Requests use public HTTPS with DNS pinning, no redirects, at most ten seconds and
an 8 KB response cap. GET encodes arguments in the query; other methods send JSON.
Signing uses the existing webhook convention: `svix-id`, `svix-timestamp`,
`svix-signature: v1,<base64 HMAC-SHA256>`. HMAC input is `id.timestamp.body`, keyed
by the supplied raw UTF-8 signing secret. GET signs an empty body. Verify the timestamp
and request ID to reject stale requests and replays.

Only allowed top-level JSON result fields reach the bot when configured. Credentials
and signatures echoed by an endpoint are redacted before return or persistence.
Readable failures omit endpoint response bodies. Tool events record result status and
latency. A durable reservation precedes HTTP execution, so replaying a tool call ID
cannot repeat side effects; reuse with different arguments is refused. If an action
crashes after reservation, the same call ID stays reserved rather than retrying an
uncertain external side effect.

This change requires schema/function deployment and service rebuilds. It adds tables,
indexes and optional fields only; no backfill, marketing service, deployment or live
provider call is included in this work.
