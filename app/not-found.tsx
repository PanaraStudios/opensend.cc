import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1>Page not found.</h1>
      <p className="text-muted-foreground">
        Check the URL, or return to your dashboard.
      </p>
      <Button nativeButton={false} render={<Link href="/" />}>
        Back to dashboard
      </Button>
    </main>
  )
}
