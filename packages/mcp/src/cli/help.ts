export const HELP_TEXT = `
Opensend MCP server

Usage:
  opensend-mcp [options]
  OPENSEND_API_KEY=os_test0000000000000000000000000000 OPENSEND_BASE_URL=https://api.example.com opensend-mcp [options]

Options:
  --base-url <url>         Required API origin (or set OPENSEND_BASE_URL)
  --key <key>              Opensend API key (or set OPENSEND_API_KEY)
  --sender <email>         Default from address (or OPENSEND_SENDER_EMAIL_ADDRESS)
  --reply-to <email>       Reply-to; repeat for multiple (or OPENSEND_REPLY_TO_EMAIL_ADDRESSES)
  --http                   Run HTTP server (Streamable HTTP at /mcp) instead of stdio
  --port <number>          HTTP port when using --http (default: 3000, or OPENSEND_MCP_PORT)
  --host <host>            Host for DNS-rebinding protection (default: 127.0.0.1, or OPENSEND_MCP_HOST).
                           Use 0.0.0.0 to disable Host validation behind a proxy/load balancer.
  --allowed-hosts <list>   Comma-separated Host allow-list (or OPENSEND_MCP_ALLOWED_HOSTS)
  -h, --help               Show this help
  -v, --version            Show the installed version

Environment:
  OPENSEND_BASE_URL        Required in both transports unless --base-url is set
  OPENSEND_API_KEY           Required for stdio if --key not set
  OPENSEND_SENDER_EMAIL_ADDRESS     Optional
  OPENSEND_REPLY_TO_EMAIL_ADDRESSES Optional, comma-separated
  OPENSEND_MCP_PORT                 HTTP port when using --http (optional)
  OPENSEND_MCP_HOST                 Host for DNS-rebinding protection when using --http (optional)
  OPENSEND_MCP_ALLOWED_HOSTS        Comma-separated Host allow-list when using --http (optional)
`.trim()

export function printHelp(): void {
  console.error(HELP_TEXT)
}
