import type { Metadata } from "next"

import { TemplatesView } from "@/components/dashboard/templates/list"

export const metadata: Metadata = {
  title: "Templates",
}

export default function TemplatesPage() {
  return <TemplatesView />
}
