/** Dashboard routes shared by logs and inbox bubbles. */
export function messageHref(
  kind: "email" | "received" | "channel",
  id: string
) {
  const prefix = {
    email: "/emails",
    received: "/emails/receiving",
    channel: "/emails/messages",
  }[kind]
  return `${prefix}/${id}`
}
export const threadHref = (id: string | null) =>
  id ? `/playground/inbox?c=${encodeURIComponent(id)}` : "/playground/inbox"

/** Preserve deep links, including repeated query values, on legacy routes. */
export function playgroundRedirectHref(
  tab: "inbox" | "calls",
  searchParams: Record<string, string | string[] | undefined>
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      query.append(key, item)
  }
  const search = query.toString()
  return `/playground/${tab}${search ? `?${search}` : ""}`
}
