import { requireAccount } from "@/lib/auth/server"
import type { Metadata } from "next"

import { DashboardShell } from "@/components/dashboard/shell"

export const metadata: Metadata = {
  title: {
    default: "Dashboard",
    template: "%s · opensend.cc",
  },
  robots: { index: false, follow: false },
}

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  await requireAccount()
  return <DashboardShell>{children}</DashboardShell>
}
