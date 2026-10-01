/** Canonical routing members. Convex, REST, OpenAPI, SDK and MCP derive from this. */
export const callingRoutingMembers = {
  agents: {},
  api: {},
  bot: { botId: "voiceBots" },
  ivr: { ivrId: "ivrs" },
} as const

type RoutingMembers = typeof callingRoutingMembers
export type CallingRouting<
  Ids extends Record<"voiceBots" | "ivrs", string> = {
    voiceBots: string
    ivrs: string
  },
> = {
  [Kind in keyof RoutingMembers]: { kind: Kind } & {
    [Field in keyof RoutingMembers[Kind]]: Ids[RoutingMembers[Kind][Field] &
      keyof Ids]
  }
}[keyof RoutingMembers]

export function parseCallingRouting(input: unknown): CallingRouting {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid calling routing")
  const r = input as Record<string, unknown>
  if (
    typeof r.kind !== "string" ||
    !Object.prototype.hasOwnProperty.call(callingRoutingMembers, r.kind)
  )
    throw new Error("Invalid calling routing kind")
  const fields = callingRoutingMembers[r.kind as keyof RoutingMembers]
  if (Object.keys(r).length !== 1 + Object.keys(fields).length)
    throw new Error("Invalid calling routing fields")
  for (const field of Object.keys(fields))
    if (
      typeof r[field] !== "string" ||
      !/^[a-zA-Z0-9._:-]{1,256}$/.test(r[field])
    )
      throw new Error("Invalid calling routing reference")
  return r as CallingRouting
}

export const callingRoutingSchema = {
  oneOf: Object.entries(callingRoutingMembers).map(([kind, fields]) => ({
    type: "object" as const,
    properties: {
      kind: { const: kind },
      ...Object.fromEntries(
        Object.keys(fields).map((field) => [field, { type: "string" }])
      ),
    },
    required: ["kind", ...Object.keys(fields)],
    additionalProperties: false,
  })),
}
