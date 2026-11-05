/** What a recipient sees above their topics, set in Settings → Unsubscribe. */
export type UnsubscribePage = {
  brandName: string
  heading: string
  body: string
}

/** A team that never saved its page shows these, under the team's name. */
export const UNSUBSCRIBE_PAGE_DEFAULTS = {
  heading: "Manage your email preferences",
  body: "Choose the topics you still want from this workspace.",
}

const LIMITS = { brandName: 100, heading: 200, body: 1000 }

/** The trimmed page, or the first problem with it. */
export function unsubscribePageInput(
  input: UnsubscribePage
): { page: UnsubscribePage } | { error: string } {
  const page = {
    brandName: input.brandName.trim(),
    heading: input.heading.trim(),
    body: input.body.trim(),
  }
  if (!page.brandName || page.brandName.length > LIMITS.brandName)
    return { error: `Use a brand name of 1 to ${LIMITS.brandName} characters` }
  if (!page.heading || page.heading.length > LIMITS.heading)
    return { error: `Use a heading of 1 to ${LIMITS.heading} characters` }
  if (page.body.length > LIMITS.body)
    return { error: `Keep the body under ${LIMITS.body} characters` }
  return { page }
}
