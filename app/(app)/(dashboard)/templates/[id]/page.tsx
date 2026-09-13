import type { Metadata } from "next"

import { TemplateDetail } from "@/components/dashboard/templates"

export const metadata: Metadata = {
  title: "Template",
}

export default function TemplateDetailPage() {
  return <TemplateDetail />
}
