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
  id ? `/emails/inbox?c=${encodeURIComponent(id)}` : "/emails/inbox"
