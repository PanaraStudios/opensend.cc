import { createAuthClient } from "better-auth/react"
import { convexClient } from "@convex-dev/better-auth/client/plugins"
import {
  twoFactorClient,
  organizationClient,
  genericOAuthClient,
} from "better-auth/client/plugins"
export const authClient = createAuthClient({
  plugins: [
    convexClient(),
    organizationClient(),
    twoFactorClient(),
    genericOAuthClient(),
  ],
})
export async function authResult<T>(result: {
  data: T
  error: { message?: string } | null
}) {
  if (result.error) throw new Error(result.error.message || "Please try again")
  return result.data
}
