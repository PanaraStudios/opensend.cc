import { AuthProvider } from "@/components/auth/provider"
import { publicConvexUrl } from "@/lib/auth/server"
import { connection } from "next/server"
import type { Metadata } from "next"

/* Account and leftover auth routes have nothing worth ranking. */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  await connection()
  return <AuthProvider url={publicConvexUrl()}>{children}</AuthProvider>
}
