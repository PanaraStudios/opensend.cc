export type MetaConnectConfig = {
  configured: boolean
  appId?: string
  configIds: { whatsapp?: string; facebookLogin?: string }
  graphVersion: string
}
export type MetaConnectFlow = "whatsapp" | "facebookLogin"

export function metaConfigurationNotice(ids: MetaConnectConfig["configIds"]) {
  if (ids.whatsapp && ids.facebookLogin) return null
  const unavailable = ids.whatsapp
    ? " (Facebook Login for Business is unavailable)"
    : ids.facebookLogin
      ? " (WhatsApp Embedded Signup is unavailable)"
      : ""
  return `Connect with Meta needs configuration IDs${unavailable}. You can still connect manually with an access token.`
}

/** One reason drives both the disabled state and its explanation. */
export function metaConnectUnavailable(
  config: MetaConnectConfig | undefined,
  flow: MetaConnectFlow,
  {
    canWrite,
    sdkReady,
    pending,
  }: { canWrite: boolean; sdkReady: boolean; pending: boolean }
): string | null {
  if (!canWrite) return "Create or join a team to connect a channel"
  if (!config?.configured || !config.appId)
    return "Ask your instance admin to add the Meta app in Meta app settings"
  if (!config.configIds[flow])
    return flow === "whatsapp"
      ? "Add the WhatsApp Embedded Signup config ID in Meta app settings"
      : "Add the Facebook Login for Business config ID in Meta app settings"
  if (pending) return "Wait for the current connection to finish"
  if (!sdkReady)
    return "Waiting for the Meta login SDK. Check that your browser allows it to load"
  return null
}
