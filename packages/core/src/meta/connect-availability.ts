export type MetaConnectConfig = {
  configured: boolean
  appId?: string
  configIds: { whatsapp?: string; facebookLogin?: string }
  graphVersion: string
}
export type MetaConnectFlow = "whatsapp" | "facebookLogin"

/** Whether a channel can connect at all: the caller writes to a team and
    the instance has a Meta app. An access token needs nothing more. */
export function manualConnectUnavailable(
  config: MetaConnectConfig | undefined,
  canWrite: boolean
): string | null {
  if (!canWrite) return "Create or join a team to connect a channel"
  if (!config?.configured || !config.appId)
    return "Ask your instance admin to add the Meta app in Meta app settings"
  return null
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
  const blocked = manualConnectUnavailable(config, canWrite)
  if (blocked) return blocked
  if (!config?.configIds[flow])
    return flow === "whatsapp"
      ? "Add the WhatsApp Embedded Signup config ID in Meta app settings"
      : "Add the Facebook Login for Business config ID in Meta app settings"
  if (pending) return "Wait for the current connection to finish"
  if (!sdkReady)
    return "Waiting for the Meta login SDK. Check that your browser allows it to load"
  return null
}

/** A channel opens Meta's login when its configuration ID is set, and the
    access-token dialog when it is not, so it can always connect somehow. */
export function metaConnectRoute(
  config: MetaConnectConfig | undefined,
  flow: MetaConnectFlow,
  availability: { canWrite: boolean; sdkReady: boolean; pending: boolean }
): { manual: boolean; reason: string | null } {
  const manual =
    !manualConnectUnavailable(config, availability.canWrite) &&
    !config?.configIds[flow]
  return {
    manual,
    reason: manual ? null : metaConnectUnavailable(config, flow, availability),
  }
}
