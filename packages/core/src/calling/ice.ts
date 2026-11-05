export const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"]
export interface IceConfiguration {
  iceServers: { urls: string[]; username?: string; credential?: string }[]
  expiresAt: number | null
}
/** Expired TURN credentials must never be offered to a new peer connection. */
export function browserIceServers(
  configuration?: IceConfiguration,
  now = Date.now()
): RTCIceServer[] {
  if (!configuration) return [{ urls: DEFAULT_STUN_URLS }]
  return configuration.iceServers.filter(
    (server) =>
      server.urls.every((url) => /^stuns?:/.test(url)) ||
      (configuration.expiresAt !== null &&
        configuration.expiresAt > now &&
        !!server.username &&
        !!server.credential)
  )
}
export function usesTurn(servers: RTCIceServer[]) {
  return servers.some((server) =>
    (typeof server.urls === "string" ? [server.urls] : server.urls).some(
      (url) => /^turns?:/.test(url)
    )
  )
}
export function iceNeedsRefresh(
  configuration: IceConfiguration,
  now = Date.now()
) {
  return (
    configuration.expiresAt !== null &&
    configuration.expiresAt <= now + 5 * 60 * 1000
  )
}
