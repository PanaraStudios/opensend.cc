const SERVER_FAILURE =
  "Something went wrong on our side. Please try again; if it keeps happening, share the reference with your administrator."
const NETWORK_FAILURE =
  "Can't reach the server. Check your connection and try again."

/** Convex wraps every error message it sends to the browser:
    `[CONVEX A(module:fn)] [Request ID: abc] Server Error\n  Called by client`,
    or `Uncaught Error: …` from a development deployment. Returns the part a
    person should read, or null when nothing readable is left. */
function readable(message: string): { text: string | null; ref?: string } {
  const ref = /\[Request ID: ([0-9a-f]+)\]/i.exec(message)?.[1]
  const text = message
    .replace(/\[CONVEX [A-Z]\([^)]*\)\]\s*/g, "")
    .replace(/\[Request ID: [^\]]*\]\s*/gi, "")
    .replace(/\s*Called by client\s*$/i, "")
    .replace(/^Uncaught (?:Convex)?Error:\s*/i, "")
    .split("\n")[0]
    .trim()
  return {
    text: !text || /^Server Error$/i.test(text) ? null : text,
    ...(ref ? { ref } : {}),
  }
}

/** The message to show for a failed Convex call (or any thrown value).
    `ConvexError` data written for people is shown as is; internal failures
    become one plain sentence with Convex's request id as the reference. */
export function actionError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof error.data === "string"
  )
    return error.data
  if (error && typeof error === "object" && "data" in error) {
    const data = error.data
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof data.message === "string"
    )
      return data.message
  }
  if (!(error instanceof Error)) return "Please try again"
  if (
    /failed to fetch|networkerror|load failed|connection lost/i.test(
      error.message
    )
  )
    return NETWORK_FAILURE
  const { text, ref } = readable(error.message)
  if (text) return text
  return ref ? `${SERVER_FAILURE} (Reference: ${ref})` : SERVER_FAILURE
}
