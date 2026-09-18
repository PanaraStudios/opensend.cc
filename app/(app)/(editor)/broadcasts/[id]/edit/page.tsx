import type { Metadata } from "next"

import { BroadcastEditor } from "@/components/dashboard/broadcasts/editor"

export const metadata: Metadata = {
  title: "Edit broadcast",
}

export default function BroadcastEditorPage() {
  return <BroadcastEditor />
}
