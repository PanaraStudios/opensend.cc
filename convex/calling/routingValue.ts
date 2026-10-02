import { v, type Validator } from "convex/values"
import type { Id } from "../_generated/dataModel"
import {
  callingRoutingMembers,
  type CallingRouting,
} from "../../services/call-gateway/src/voice/routing"

type Routing = CallingRouting<{ voiceBots: Id<"voiceBots">; ivrs: Id<"ivrs"> }>
export const callingRouting = v.union(
  ...Object.entries(callingRoutingMembers).map(([kind, fields]) =>
    v.object({
      kind: v.literal(kind),
      ...Object.fromEntries(
        Object.entries(fields).map(([field, table]) => [field, v.id(table)])
      ),
    })
  )
) as Validator<Routing, "required", "kind" | "botId" | "ivrId">
