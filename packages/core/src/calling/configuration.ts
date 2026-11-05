/** The browser and session action must agree on a usable secure SIP endpoint. */
export function validAgentWssUrl(value: string | undefined) {
  try {
    const url = new URL(value ?? "")
    return (
      url.protocol === "wss:" && !url.username && !url.password && !url.hash
    )
  } catch {
    return false
  }
}
