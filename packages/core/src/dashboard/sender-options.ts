/** Sender suggestions are indexed by domain, even when a mailbox is pasted. */
export function senderDomainSearch(value: string) {
  const text = value.trim()
  return text
    .slice(text.lastIndexOf("@") + 1)
    .replace(/>$/, "")
    .trim()
}
