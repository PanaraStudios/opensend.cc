import "server-only"
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs"
import { ConvexHttpClient } from "convex/browser"
import { redirect } from "next/navigation"
import { api } from "@/convex/_generated/api"
function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be configured. Run pnpm setup.`)
  return value
}
/** Constructed per request: no build-time hostnames or secrets in client bundles. */
export function serverAuth() {
  return convexBetterAuthNextJs({
    convexUrl: required("CONVEX_INTERNAL_URL"),
    convexSiteUrl: required("CONVEX_INTERNAL_SITE_URL"),
  })
}
export async function requireAccount() {
  const token = await serverAuth().getToken()
  if (!token) redirect("/login")
  const client = new ConvexHttpClient(required("CONVEX_INTERNAL_URL"))
  client.setAuth(token)
  try {
    const account = await client.query(api.teams.snapshot, {})
    if (!account) redirect("/login")
    return account
  } catch {
    redirect("/login")
  }
}
export function publicConvexUrl() {
  return required("CONVEX_PUBLIC_URL")
}
