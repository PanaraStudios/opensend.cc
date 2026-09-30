# @opensend/mcp

MCP server for self-hosted Opensend, using `@opensend/sdk`. Ported from
[resend-mcp](https://github.com/resend/resend-mcp) 2.24.0,
commit `96dd92f9065130702f8ab898a8583c5fab469c0c`. Requires Node.js 22+.
**Not published yet.** Build and run from this workspace; do not publish.

## Run

```sh
pnpm --filter @opensend/sdk build
pnpm --filter @opensend/mcp build
OPENSEND_API_KEY=… OPENSEND_BASE_URL=https://api.example.com opensend-mcp
```

Until installed as a CLI, replace `opensend-mcp` with
`node /absolute/path/to/packages/mcp/dist/index.js`.
The required base URL is your installation's Convex HTTP API origin
(`CONVEX_PUBLIC_SITE_URL`), not the dashboard URL. `--key` and `--base-url`
override the environment. There is no default API origin.

HTTP (Streamable HTTP at `/mcp` and `/`, health check at `/health`):

```sh
OPENSEND_BASE_URL=https://api.example.com opensend-mcp --http --port 3000
```

HTTP clients supply their own Opensend key in `Authorization: Bearer <key>`;
there is no fallback to the server's key. Legacy sessions require the same key
on subsequent requests. Modern requests are stateless. Host validation defaults
to localhost; `--host` and `--allowed-hosts` configure it for reverse proxies.

Optional defaults: `--sender` / `OPENSEND_SENDER_EMAIL_ADDRESS`, `--reply-to` /
`OPENSEND_REPLY_TO_EMAIL_ADDRESSES` (comma-separated).
HTTP settings: `OPENSEND_MCP_PORT`, `OPENSEND_MCP_HOST`, `OPENSEND_MCP_ALLOWED_HOSTS`.
Use `--help` for all flags.

## Client configuration

Use this JSON for **Claude Desktop** (`claude_desktop_config.json`),
**Claude Code** (`.mcp.json`), or **Cursor** (`.cursor/mcp.json`). Replace the
absolute path, key, and origin with your installation's values:

```json
{
  "mcpServers": {
    "opensend": {
      "command": "node",
      "args": ["/absolute/path/to/packages/mcp/dist/index.js"],
      "env": {
        "OPENSEND_API_KEY": "os_test0000000000000000000000000000",
        "OPENSEND_BASE_URL": "https://api.example.com"
      }
    }
  }
}
```

For HTTP, Claude Code's `.mcp.json` uses:

```json
{
  "mcpServers": {
    "opensend": {
      "type": "http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer os_test0000000000000000000000000000"
      }
    }
  }
}
```

## Tools (101)

Kept tool names and input shapes match upstream; descriptions reflect Opensend.

| Resource          | Tools                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apiKeys           | `create-api-key`, `list-api-keys`, `update-api-key`, `remove-api-key`                                                                                                                                                                                                                                           |
| automations       | `create-automation`, `update-automation`, `get-automation`, `duplicate-automation`, `remove-automation`, `get-automation-runs`                                                                                                                                                                                  |
| broadcasts        | `create-broadcast`, `send-broadcast`, `list-broadcasts`, `get-broadcast`, `cancel-broadcast`, `duplicate-broadcast`, `remove-broadcast`, `update-broadcast`, `list-broadcast-clicked-links`, `list-broadcast-recipients`                                                                                        |
| contactImports    | `create-contact-import`, `get-contact-import`, `list-contact-imports`                                                                                                                                                                                                                                           |
| contactProperties | `create-contact-property`, `list-contact-properties`, `get-contact-property`, `update-contact-property`, `remove-contact-property`                                                                                                                                                                              |
| contacts          | `create-contact`, `list-contacts`, `get-contact`, `update-contact`, `remove-contact`, `add-contact-to-segment`, `remove-contact-from-segment`, `list-contact-segments`, `list-contact-topics`, `update-contact-topics`                                                                                          |
| domains           | `create-domain`, `list-domains`, `get-domain`, `update-domain`, `remove-domain`, `verify-domain`, `create-domain-claim`, `get-domain-claim`, `verify-domain-claim`                                                                                                                                              |
| emails            | `send-email`, `list-emails`, `get-email`, `list-received-emails`, `get-received-email`, `list-received-email-attachments`, `get-received-email-attachment`, `cancel-email`, `update-email`, `share-email`, `get-email-metrics`, `list-sent-email-attachments`, `get-sent-email-attachment`, `send-batch-emails` |
| events            | `send-event`, `manage-events`                                                                                                                                                                                                                                                                                   |
| logs              | `list-logs`, `get-log`                                                                                                                                                                                                                                                                                          |
| oauthGrants       | `list-oauth-grants`, `revoke-oauth-grant`                                                                                                                                                                                                                                                                       |
| segments          | `create-segment`, `list-segments`, `get-segment`, `update-segment`, `remove-segment`                                                                                                                                                                                                                            |
| suppressions      | `add-suppression`, `list-suppressions`, `get-suppression`, `remove-suppression`, `batch-add-suppressions`, `batch-remove-suppressions`                                                                                                                                                                          |
| templates         | `create-template`, `list-templates`, `get-template`, `update-template`, `remove-template`, `publish-template`, `duplicate-template`                                                                                                                                                                             |
| topics            | `create-topic`, `list-topics`, `get-topic`, `update-topic`, `remove-topic`                                                                                                                                                                                                                                      |
| usage             | `get-usage`                                                                                                                                                                                                                                                                                                     |
| webhooks          | `create-webhook`, `list-webhooks`, `get-webhook`, `update-webhook`, `list-webhook-events`, `get-webhook-event`, `replay-webhook-event`, `rotate-webhook-signing-secret`, `list-webhook-event-attempts`, `remove-webhook`                                                                                        |

## Differences from resend-mcp

- Uses only `OPENSEND_*` settings, with required API origin; never reads
  `RESEND_*` settings. User agent: `opensend-mcp:0.1.0`.
- Removed `get-tiptap-json-content` (hosted schema/content), `connect-to-editor`
  and `disconnect-from-editor` (hosted editor sessions), and `compose-template`
  and `compose-broadcast` (hosted TipTap writes). Their dashboard/editor clients
  are omitted. Use REST create/update tools with HTML/text instead.
- Templates, broadcasts, and automations take raw IDs (templates also accept
  aliases). Hosted dashboard URL parsing, preview links, and editor prompts are
  removed. Contact tools use global contacts and segment routes, never legacy
  audience contact routes.
- SDK 6.30.0 lacks four webhook event types exposed by upstream 6.31.0:
  `contact.topics.updated`, `topic.created`, `topic.updated`, `topic.deleted`.
  Opensend does not serve those events either. Create/update webhook retain the
  upstream schema but reject those values before HTTP; they use generic SDK
  `post`/`patch` calls. No SDK source changes or other missing methods.
- Opensend's [REST parity limits](../../docs/resend-parity.md) apply. Automation
  descriptions use `opensend:` lifecycle events and document unsupported step
  options. Boolean contact-import properties are unsupported. Broadcast
  descriptions point agents to `{{{OPENSEND_UNSUBSCRIBE_URL}}}`; Opensend also
  fills the legacy `{{{RESEND_UNSUBSCRIBE_URL}}}` in broadcasts, and templates
  keep it reserved.
- MCP SDK packages remain at upstream 2.0.0; Zod is pinned to 4.6.1 to match
  their resolved types. Vitest uses the workspace's 3.2.4 with two workers.

## Development

```sh
pnpm test:mcp                         # builds SDK + MCP, then offline tests
pnpm --filter @opensend/mcp build
pnpm --filter @opensend/mcp typecheck # source and tests
```

Tests cover upstream behavior, all registered tools against the OpenAPI operation
inventory, SDK request headers, both HTTP protocol modes, and built stdio startup.
The read-only live test is skipped unless **both** `OPENSEND_BASE_URL_LIVE` and
`OPENSEND_API_KEY` are set. It calls `list-domains`, `list-api-keys`, and
`list-emails` through an MCP client. Never enable it unintentionally.

After integration, smoke-test those three reads against your installation using
stdio and HTTP with a full-access key. With explicit operator approval, also
check a verified-sender email, draft template create/update/publish, draft
broadcast create/update, and webhook create/update using supported events.

## License

Apache-2.0; see [LICENSE](LICENSE). Derived MIT code remains attributed to
Copyright 2026 Plus Five Five, Inc in [LICENSE-resend-mcp](LICENSE-resend-mcp)
and the repository [NOTICE](../../NOTICE).
