import { createAuth } from "../auth"
import type { GenericCtx } from "@convex-dev/better-auth"
import type { DataModel } from "../_generated/dataModel"
// Schema generation only; never imported at runtime.
export const auth = createAuth({} as GenericCtx<DataModel>)
