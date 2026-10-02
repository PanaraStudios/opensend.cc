export const metadata: Metadata = { title: { absolute: "Calls · opensend.cc" } }
import type { Metadata } from "next"
import { CallsView } from "@/components/dashboard/calling/calls-view"

export default function CallsPage() {
  return <CallsView />
}
