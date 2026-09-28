import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { api } from "@/convex/_generated/api"
import { serverConvex } from "@/lib/auth/server"
import { UnsubscribePreferences } from "@/components/unsubscribe/preferences"

/* Opened from a recipient's email, signed out. The link is the only
   credential, so it must not leak through the Referer header. */
export const metadata: Metadata = {
  title: "Unsubscribe",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  if (!(await serverConvex().query(api.unsubscribe.preferences, { token })))
    notFound()
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <UnsubscribePreferences token={token} />
      </div>
    </main>
  )
}
