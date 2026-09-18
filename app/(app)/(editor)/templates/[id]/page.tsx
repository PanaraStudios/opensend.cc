import type { Metadata } from "next"

import { TemplateEditor } from "@/components/dashboard/templates/editor"

export const metadata: Metadata = {
  title: "Edit template",
}

export default function TemplateEditorPage() {
  return <TemplateEditor />
}
