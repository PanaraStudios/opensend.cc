import type { Metadata } from "next"
import { AuthPageFrame } from "@/components/auth/page-frame"
export const metadata: Metadata = { robots: { index: false, follow: true } }
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AuthPageFrame>{children}</AuthPageFrame>
}
