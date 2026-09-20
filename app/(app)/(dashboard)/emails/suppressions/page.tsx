import type { Metadata } from "next"

import { SuppressionsView } from "@/components/dashboard/emails/lists"

export const metadata: Metadata = {
  title: "Suppressions",
}

export default function SuppressionsPage() {
  return <SuppressionsView />
}
