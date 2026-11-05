import { createHmac } from "node:crypto"
import { ConvexError } from "convex/values"
import { DEFAULT_STUN_URLS, type IceConfiguration } from "./ice"

export function turnCredential(secret: string, username: string) {
  return createHmac("sha1", secret).update(username).digest("base64")
}
function urls(value: string | undefined, pattern: RegExp): string[] {
  const result = value?.split(/[\s,]+/).filter(Boolean) ?? []
  if (result.some((url) => !pattern.test(url)))
    throw new ConvexError("Invalid calling ICE server configuration")
  return result
}
/** Only derived credentials leave the backend; the shared secret stays here. */
export function buildIceServers(config: {
  stunUrls?: string
  turnUrls?: string
  secret?: string
  leaseId: string
  now: number
}): IceConfiguration {
  const stun =
    config.stunUrls === undefined || config.stunUrls === ""
      ? DEFAULT_STUN_URLS
      : urls(config.stunUrls, /^stuns?:[^\s@/#]+$/)
  const iceServers: IceConfiguration["iceServers"] = stun.length
    ? [{ urls: stun }]
    : []
  if (!config.turnUrls || !config.secret) return { iceServers, expiresAt: null }
  const turn = urls(
    config.turnUrls,
    /^turns?:[^\s@/#?]+(?:\?transport=(?:udp|tcp))?$/
  )
  if (!turn.length) return { iceServers, expiresAt: null }
  const expiry = Math.floor(config.now / 1000) + 3600
  const username = `${expiry}:${config.leaseId}`
  iceServers.push({
    urls: turn,
    username,
    credential: turnCredential(config.secret, username),
  })
  return { iceServers, expiresAt: expiry * 1000 }
}
