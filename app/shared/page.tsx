import type { Metadata } from "next"
import { api } from "@/convex/_generated/api"
import { serverConvex } from "@/lib/auth/server"
import { SharedEmailView } from "@/components/emails/shared-view"

export const metadata: Metadata = {
  title: "Shared email",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

export default async function SharedPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  let email = null
  let unavailable = false
  if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
    try {
      const client = serverConvex()
      email = await client.action(api.emailShares.view, { token })
    } catch {
      unavailable = true
    }
  }
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-4 py-8 sm:px-6">
      <SharedEmailView email={email} unavailable={unavailable} />
    </main>
  )
}
