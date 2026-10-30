import type { Metadata } from "next"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@/components/ui/empty"

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6">
      <Empty>
        <EmptyHeader>
          <h1 className="text-h3">Page not found.</h1>
          <EmptyDescription>
            Check the URL, or return to your dashboard.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button nativeButton={false} render={<Link href="/" />}>
            Back to dashboard
          </Button>
        </EmptyContent>
      </Empty>
    </main>
  )
}
