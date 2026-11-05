import type { ActionCtx } from "./_generated/server"
import { authComponent } from "./auth"

/** Upstream's rotation CAS compares revoked = null, not an absent field. */
export function oauthAdapter(
  ctx: ActionCtx
): ReturnType<typeof authComponent.adapter> {
  const base = authComponent.adapter(ctx)
  return (options) => {
    const adapter = base(options)
    return {
      ...adapter,
      create: (args) =>
        adapter.create({
          ...args,
          data:
            args.model === "oauthRefreshToken"
              ? { ...args.data, revoked: null }
              : args.data,
        }),
    }
  }
}
