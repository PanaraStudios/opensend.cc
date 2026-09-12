import type { Metadata } from "next"

/* Account and leftover auth routes have nothing worth ranking. */
export const metadata: Metadata = {
  robots: { index: false, follow: true },
}

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return children
}
