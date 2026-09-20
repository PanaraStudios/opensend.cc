"use client"
import { useState } from "react"
import { ConvexReactClient } from "convex/react"
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"
import { authClient } from "@/lib/auth/client"
export function AuthProvider({
  url,
  children,
}: {
  url: string
  children: React.ReactNode
}) {
  const [client] = useState(() => new ConvexReactClient(url))
  return (
    <ConvexBetterAuthProvider client={client} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  )
}
