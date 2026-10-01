export interface Config {
  port: number
  secret: string
  janusUrl: string
  janusAdminUrl: string
  janusSecret: string
  fsHost: string
  fsPort: number
  fsSecret: string
  directorySecret: string
  sipSecret: string
  convexUrl: string
}
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const secret = (key: string) => {
    const value = env[key] ?? ""
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(value))
      throw new Error(
        `${key} must be 32–128 alphanumeric, underscore or hyphen characters`
      )
    return value
  }
  const url = (key: string, fallback?: string) => {
    const parsed = new URL(env[key] ?? fallback ?? "")
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(`Invalid ${key}`)
    return parsed.toString().replace(/\/$/, "")
  }
  const port = (key: string, fallback: number) => {
    const value = Number(env[key] ?? fallback)
    if (!Number.isInteger(value) || value < 1 || value > 65535)
      throw new Error(`Invalid ${key}`)
    return value
  }
  const fsHost = env.FREESWITCH_HOST ?? "freeswitch"
  if (!/^[a-zA-Z0-9.-]+$/.test(fsHost))
    throw new Error("Invalid FREESWITCH_HOST")
  return {
    port: port("PORT", 8090),
    secret: secret("CALL_GATEWAY_SECRET"),
    janusUrl: url("JANUS_URL", "http://janus:8088/janus"),
    janusAdminUrl: url("JANUS_ADMIN_URL", "http://janus:7088/admin"),
    janusSecret: secret("JANUS_API_SECRET"),
    fsHost,
    fsPort: port("FREESWITCH_ESL_PORT", 8021),
    fsSecret: secret("FREESWITCH_ESL_SECRET"),
    directorySecret: secret("FREESWITCH_DIRECTORY_SECRET"),
    sipSecret: secret("FREESWITCH_SIP_SECRET"),
    convexUrl: url("CALL_GATEWAY_CONVEX_HTTP_URL"),
  }
}
