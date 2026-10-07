export const CONVEX_ENV_KEYS = [
  "SITE_URL",
  "BETTER_AUTH_SECRET",
  "SSO_ENCRYPTION_KEY",
  "SES_ENCRYPTION_KEY",
  "SES_CALLBACK_ORIGIN",
  "ALLOW_LOCAL_OIDC",
  "META_GRAPH_ORIGIN",
  "LOG_AUTH_LINKS",
  "DOMAIN_CONNECT_KEY",
  "DOMAIN_CONNECT_PRIVATE_KEY",
  "DOMAIN_CONNECT_SIGNER",
  "SMTP_HOST",
  "CALL_GATEWAY_URL",
  "CALL_GATEWAY_SECRET",
  "CALL_AGENT_WSS_URL",
  "CALL_AGENT_QUEUES",
]

/** Empty Compose defaults must not erase an existing deployment setting. */
export function convexEnvEntries(env) {
  return CONVEX_ENV_KEYS.filter((key) => env[key]).map((key) => [key, env[key]])
}
