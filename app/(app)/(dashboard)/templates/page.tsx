import type { Metadata } from "next"

import { TemplatesView } from "@/components/dashboard/templates"

export const metadata: Metadata = {
  title: "Templates",
}

export default function TemplatesPage() {
  return <TemplatesView />
}
