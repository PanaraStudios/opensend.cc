import { z } from "zod"

export const channelPagination = {
  limit: z.number().int().min(1).max(100).optional(),
  after: z.string().optional(),
  before: z.string().optional(),
}
export function channelPageCheck(input: { after?: string; before?: string }) {
  if (input.after && input.before)
    throw new Error("Cannot use both after and before.")
}
export function channelOutput(
  channel: string,
  result: { data: unknown; error: unknown }
) {
  if (result.error)
    throw new Error(
      `${channel} request failed: ${JSON.stringify(result.error)}`
    )
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(result.data, null, 2) },
    ],
  }
}
